//! Import a user-provided D&D Beyond character snapshot, without network access.
use crate::{ability_modifier, Character, ImportedSource, Project};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Serialize)]
pub struct Preview {
    pub character: Character,
    pub warnings: Vec<String>,
}
fn arr(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn number(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| (-1_000_000..=1_000_000).contains(n))
}
fn name(v: &Value) -> &str {
    v["definition"]["name"]
        .as_str()
        .or_else(|| v["name"].as_str())
        .unwrap_or("")
}
fn plain(s: &str) -> String {
    let mut tag = false;
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '<' => {
                tag = true;
                out.push(' ');
            }
            '>' => tag = false,
            _ if !tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .trim()
        .to_string()
}
fn stat(data: &Value, field: &str, id: i64) -> Option<i64> {
    arr(&data[field])
        .iter()
        .find(|v| number(&v["id"]) == Some(id))
        .and_then(|v| number(&v["value"]))
}
fn active_modifiers(data: &Value) -> Vec<&Value> {
    let mut mods = Vec::new();
    for group in ["race", "class", "background", "feat"] {
        mods.extend(arr(&data["modifiers"][group]));
    }
    for item in arr(&data["inventory"]) {
        if item["equipped"] == true
            && (item["definition"]["canAttune"] != true || item["isAttuned"] == true)
        {
            mods.extend(arr(&item["definition"]["grantedModifiers"]));
        }
    }
    let mut seen = HashSet::new();
    mods.retain(|m| m["id"].is_null() || seen.insert(m["id"].to_string()));
    mods
}
fn modifier_value(v: &Value) -> Option<i64> {
    number(&v["value"]).or_else(|| number(&v["fixedValue"]))
}
fn unrestricted(v: &Value) -> bool {
    text(&v["restriction"]).trim().is_empty() && v["isGranted"] != false
}
fn feature_levels(data: &Value, component: &Value, total: i64) -> i64 {
    if component.is_null() {
        return total;
    }
    arr(&data["classes"])
        .iter()
        .find(|c| {
            arr(&c["classFeatures"])
                .iter()
                .any(|f| f["definition"]["id"] == *component || f["id"] == *component)
        })
        .and_then(|c| number(&c["level"]))
        .unwrap_or(total)
}
pub fn parse(json: &str) -> Result<Preview, String> {
    if json.len() > 2_000_000 {
        return Err("Character data exceeds 2 MB. Import one character at a time.".into());
    }
    let root: Value = serde_json::from_str(json).map_err(|_| "This is not valid character JSON. Save the character-data page as a .json file, not the character webpage.".to_string())?;
    if root["success"] == false {
        return Err("D&D Beyond did not return a character. Check its visibility and your access on D&D Beyond.".into());
    }
    let data = if root["data"].is_object() {
        &root["data"]
    } else if root["character"].is_object() {
        &root["character"]
    } else {
        &root
    };
    let id = data["id"]
        .as_u64()
        .or_else(|| text(&data["id"]).parse().ok())
        .filter(|id| *id > 0 && *id <= 9_007_199_254_740_991)
        .ok_or("Missing D&D Beyond character ID.")?;
    let character_name = text(&data["name"]).trim();
    if character_name.is_empty() || !data["stats"].is_array() || arr(&data["classes"]).is_empty() {
        return Err("This file is not a complete D&D Beyond character (name, classes, and ability scores are required).".into());
    }
    let classes = arr(&data["classes"]);
    let mut level = 0i64;
    let mut class_names = Vec::new();
    for c in classes {
        let l = number(&c["level"])
            .filter(|n| (1..=20).contains(n))
            .ok_or("A class has an invalid level.")?;
        if name(c).is_empty() {
            return Err("A class is missing its name.".into());
        }
        level += l;
        class_names.push(format!("{} {}", name(c), l));
    }
    if !(1..=20).contains(&level) {
        return Err("Total character level must be 1–20.".into());
    }
    let mut warnings = vec!["This is a one-time copy, not a live sync. Check the preview against your D&D Beyond sheet before adding it.".into(),
        "Conditional effects, custom overrides, choices, and some item/class features may need manual adjustment. Combat automation is not imported; the original JSON is retained with this character.".into()];
    let mods = active_modifiers(data);
    if mods.iter().any(|m| !unrestricted(m)) {
        warnings.push(
            "Conditional or inactive bonuses were excluded from calculated ability scores and HP."
                .into(),
        );
    }
    let mut abilities = [10u8; 6];
    for (i, ability) in [
        "strength",
        "dexterity",
        "constitution",
        "intelligence",
        "wisdom",
        "charisma",
    ]
    .iter()
    .enumerate()
    {
        let id = (i + 1) as i64;
        if arr(&data["stats"])
            .iter()
            .filter(|v| number(&v["id"]) == Some(id))
            .count()
            != 1
        {
            return Err(format!("Missing or duplicate {ability} score."));
        }
        let base = stat(data, "stats", id)
            .filter(|n| (1..=30).contains(n))
            .ok_or_else(|| format!("Invalid {ability} score."))?;
        let subtype = format!("{ability}-score");
        let matching: Vec<_> = mods
            .iter()
            .filter(|m| text(&m["subType"]) == subtype && unrestricted(m))
            .collect();
        let bonus: i64 = matching
            .iter()
            .filter(|m| m["type"] == "bonus")
            .filter_map(|m| modifier_value(m))
            .sum();
        let cap_bonus: i64 = mods
            .iter()
            .filter(|m| {
                text(&m["subType"]) == format!("{ability}-score-maximum")
                    && m["type"] == "bonus"
                    && unrestricted(m)
            })
            .filter_map(|m| modifier_value(m))
            .sum();
        let mut value = (base + bonus).min((20 + cap_bonus).max(base))
            + stat(data, "bonusStats", id).unwrap_or(0);
        for m in matching.iter().filter(|m| m["type"] == "set") {
            if let Some(n) = modifier_value(m) {
                value = value.max(n);
            }
        }
        if let Some(n) = stat(data, "overrideStats", id).filter(|n| *n > 0) {
            value = n;
        }
        if !(1..=30).contains(&value) {
            return Err(format!(
                "Calculated {ability} is outside 1–30. Check the character data."
            ));
        }
        abilities[i] = value as u8;
    }
    let hp_override = number(&data["overrideHitPoints"]).filter(|n| *n > 0);
    let hp_base = number(&data["baseHitPoints"]);
    if hp_base.is_none() && hp_override.is_none() {
        warnings.push(
            "Maximum HP was unavailable; replace the suggested HP with the value on your sheet."
                .into(),
        );
    }
    let hp_bonus: i64 = mods
        .iter()
        .filter(|m| m["type"] == "bonus" && unrestricted(m))
        .filter_map(|m| {
            let n = modifier_value(m)?;
            match text(&m["subType"]) {
                "hit-points-per-level" => Some(n * feature_levels(data, &m["componentId"], level)),
                "hit-points" => Some(n),
                _ => None,
            }
        })
        .sum();
    let hp = hp_override
        .unwrap_or(
            hp_base.unwrap_or(0) + i64::from(ability_modifier(abilities[2])) * level + hp_bonus,
        )
        .max(1);
    if hp > 65535 {
        return Err("Calculated HP is too large.".into());
    }
    let mut notes = vec![
        format!("Imported from D&D Beyond: https://www.dndbeyond.com/characters/{id}"),
        format!("Classes: {}", class_names.join(" / ")),
    ];
    let background = if data["background"]["customBackground"]["name"]
        .as_str()
        .is_some_and(|s| !s.is_empty())
    {
        text(&data["background"]["customBackground"]["name"])
    } else {
        name(&data["background"])
    };
    if !background.is_empty() {
        notes.push(format!("Background: {background}"));
    }
    for c in classes {
        let sub = name(&c["subclassDefinition"]);
        if !sub.is_empty() {
            notes.push(format!("{} subclass: {sub}", name(c)));
        }
    }
    let current = (hp + number(&data["bonusHitPoints"]).unwrap_or(0)
        - number(&data["removedHitPoints"]).unwrap_or(0))
    .max(0);
    notes.push(format!("Estimated HP at import: {current} current / {hp} maximum; {} temporary; {} temporary maximum adjustment.",number(&data["temporaryHitPoints"]).unwrap_or(0),number(&data["bonusHitPoints"]).unwrap_or(0)));
    for field in ["notes", "traits"] {
        if let Some(map) = data[field].as_object() {
            for (key, value) in map {
                if let Some(s) = value.as_str() {
                    if !s.trim().is_empty() {
                        notes.push(format!("{key}: {}", plain(s)));
                    }
                }
            }
        }
    }
    let mut features = Vec::new();
    for feat in arr(&data["feats"]) {
        if !name(feat).is_empty() {
            features.push(name(feat).to_owned());
        }
    }
    for c in classes {
        for f in arr(&c["classFeatures"]) {
            if !name(f).is_empty() {
                features.push(name(f).to_owned());
            }
        }
    }
    for r in arr(&data["race"]["racialTraits"]) {
        if !name(r).is_empty() {
            features.push(name(r).to_owned());
        }
    }
    features.sort();
    features.dedup();
    if !features.is_empty() {
        notes.push(format!("Features & traits: {}", features.join(", ")));
    }
    let mut inventory = Vec::new();
    for item in arr(&data["inventory"]) {
        if name(item).is_empty() {
            continue;
        }
        inventory.push(format!(
            "{} × {}{}{}",
            number(&item["quantity"]).unwrap_or(1),
            name(item),
            if item["equipped"] == true {
                " · equipped"
            } else {
                ""
            },
            if item["isAttuned"] == true {
                " · attuned"
            } else {
                ""
            }
        ));
    }
    if let Some(coins) = data["currencies"].as_object() {
        inventory.push(
            coins
                .iter()
                .filter_map(|(k, v)| number(v).map(|n| format!("{n} {k}")))
                .collect::<Vec<_>>()
                .join(" · "),
        );
    }
    let mut spells = Vec::new();
    if let Some(groups) = data["spells"].as_object() {
        for list in groups.values() {
            spells.extend(arr(list).iter());
        }
    }
    for group in arr(&data["classSpells"]) {
        spells.extend(arr(&group["spells"]));
    }
    let mut spell_lines: Vec<_> = spells
        .iter()
        .filter(|s| !name(s).is_empty())
        .map(|s| {
            format!(
                "{} · level {}{}",
                name(s),
                number(&s["definition"]["level"]).unwrap_or(0),
                if s["prepared"] == true {
                    " · prepared"
                } else {
                    ""
                }
            )
        })
        .collect();
    spell_lines.sort();
    spell_lines.dedup();
    let character = Character {
        name: character_name.into(),
        ancestry: data["race"]["fullName"]
            .as_str()
            .or_else(|| data["race"]["baseName"].as_str())
            .unwrap_or("")
            .into(),
        class: class_names.join(" / "),
        level: level as u8,
        hp: hp as u16,
        abilities,
        notes: notes.join("\n\n"),
        inventory: inventory.join("\n"),
        spells: spell_lines.join("\n"),
        source: Some(ImportedSource {
            kind: "dndbeyond".into(),
            id,
            original: serde_json::to_string(data).unwrap(),
            warnings: warnings.clone(),
        }),
    };
    let mut project = Project::default();
    project.characters.push(character.clone());
    project.validate()?;
    Ok(Preview {
        character,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn sample() -> Value {
        json!({"id":123456,"name":"Ari","classes":[{"level":3,"definition":{"name":"Wizard"}}],"stats":[{"id":1,"value":8},{"id":2,"value":14},{"id":3,"value":14},{"id":4,"value":15},{"id":5,"value":12},{"id":6,"value":10}],"baseHitPoints":14,"race":{"fullName":"High Elf"},"modifiers":{"race":[{"id":"int","type":"bonus","subType":"intelligence-score","value":1}]}})
    }
    #[test]
    fn imports_wrapped_and_raw() {
        let s = sample();
        let p = parse(&json!({"success":true,"data":s}).to_string()).unwrap();
        assert_eq!(p.character.abilities, [8, 14, 14, 16, 12, 10]);
        assert_eq!(p.character.hp, 20);
        assert_eq!(p.character.level, 3);
        assert_eq!(p.character.source.unwrap().id, 123456);
        assert!(parse(&s.to_string()).is_ok());
    }
    #[test]
    fn respects_overrides() {
        let mut s = sample();
        s["overrideStats"] = json!([{"id":4,"value":19}]);
        s["overrideHitPoints"] = json!(37);
        let p = parse(&s.to_string()).unwrap();
        assert_eq!(p.character.abilities[3], 19);
        assert_eq!(p.character.hp, 37);
    }
    #[test]
    fn rejects_error_and_noncharacter() {
        assert!(parse("{\"success\":false}").is_err());
        assert!(parse("{\"version\":1}").is_err());
        assert!(parse("<html>Login</html>").is_err());
    }
    #[test]
    fn rejects_duplicate_stats() {
        let mut s = sample();
        s["stats"][1]["id"] = json!(1);
        assert!(parse(&s.to_string()).is_err());
    }
    #[test]
    fn ignores_inactive_and_conditional_items() {
        let mut s = sample();
        s["inventory"] = json!([{"equipped":true,"isAttuned":false,"definition":{"name":"Test item","canAttune":true,"grantedModifiers":[{"type":"set","subType":"strength-score","value":19}]}}]);
        s["modifiers"]["feat"] = json!([{"type":"bonus","subType":"strength-score","value":2,"restriction":"while raging"}]);
        assert_eq!(parse(&s.to_string()).unwrap().character.abilities[0], 8);
    }
    #[test]
    fn handles_multiclass_and_hp_features() {
        let mut s = sample();
        s["classes"].as_array_mut().unwrap().push(json!({"level":2,"definition":{"name":"Fighter"},"classFeatures":[{"definition":{"id":50}}]}));
        s["modifiers"]["class"] =
            json!([{"type":"bonus","subType":"hit-points-per-level","value":1,"componentId":50}]);
        let p = parse(&s.to_string()).unwrap();
        assert_eq!(p.character.level, 5);
        assert_eq!(p.character.hp, 26);
        assert_eq!(p.character.class, "Wizard 3 / Fighter 2");
    }
    #[test]
    fn old_saves_still_work() {
        let mut p = Project::default();
        let c = parse(&sample().to_string()).unwrap().character;
        let mut value = serde_json::to_value(c).unwrap();
        value.as_object_mut().unwrap().remove("source");
        p.characters.push(serde_json::from_value(value).unwrap());
        assert!(p.validate().is_ok());
    }
}
