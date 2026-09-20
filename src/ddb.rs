//! Import a user-provided D&D Beyond character snapshot, without network access.
use crate::{ability_modifier, Character, CharacterSheet, ImportedSource, Project};
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
    warnings.push("The expanded sheet imports proficiencies, skills, combat and spellcasting details where available. Armor Class is an estimate unless supplied directly; check special defenses, spell slots, and attack bonuses against D&D Beyond.".into());
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
        sheet: extended_sheet(data, &mods, &abilities, hp as u16, level as u8),
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

const ABILITIES: [&str; 6] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
];
const SKILLS: [&str; 18] = [
    "acrobatics",
    "animal-handling",
    "arcana",
    "athletics",
    "deception",
    "history",
    "insight",
    "intimidation",
    "investigation",
    "medicine",
    "nature",
    "perception",
    "performance",
    "persuasion",
    "religion",
    "sleight-of-hand",
    "stealth",
    "survival",
];
fn extended_sheet(
    data: &Value,
    mods: &[&Value],
    abilities: &[u8; 6],
    hp: u16,
    level: u8,
) -> CharacterSheet {
    let mut sheet = CharacterSheet {
        import_version: 1,
        ..Default::default()
    };
    let bounded = |v: &Value| number(v).map(|v| v.clamp(0, 65535) as u16);
    sheet.current_hp = Some(
        (hp as i64 + number(&data["bonusHitPoints"]).unwrap_or(0)
            - number(&data["removedHitPoints"]).unwrap_or(0))
        .clamp(0, 65535) as u16,
    );
    sheet.temporary_hp = bounded(&data["temporaryHitPoints"]).unwrap_or(0);
    sheet.background = text(&data["background"]["customBackground"]["name"]).to_owned();
    if sheet.background.is_empty() {
        sheet.background = name(&data["background"]).into();
    }
    sheet.subclass = arr(&data["classes"])
        .iter()
        .map(|c| name(&c["subclassDefinition"]))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" / ");
    sheet.xp = number(&data["currentXp"]).unwrap_or(0).max(0) as u32;
    sheet.inspiration = data["inspiration"] == true;
    sheet.alignment = match number(&data["alignmentId"]) {
        Some(1) => "Lawful good",
        Some(2) => "Neutral good",
        Some(3) => "Chaotic good",
        Some(4) => "Lawful neutral",
        Some(5) => "Neutral",
        Some(6) => "Chaotic neutral",
        Some(7) => "Lawful evil",
        Some(8) => "Neutral evil",
        Some(9) => "Chaotic evil",
        _ => "",
    }
    .into();
    sheet.size = text(&data["race"]["size"]).into();
    if let Some(walk) = number(&data["race"]["weightSpeeds"]["normal"]["walk"]) {
        sheet.speed = format!("{walk} ft.");
    }
    sheet.death_successes = number(&data["deathSaves"]["successCount"])
        .unwrap_or(0)
        .clamp(0, 3) as u8;
    sheet.death_failures = number(&data["deathSaves"]["failCount"])
        .unwrap_or(0)
        .clamp(0, 3) as u8;
    for (i, k) in ["cp", "sp", "ep", "gp", "pp"].iter().enumerate() {
        sheet.currency[i] = number(&data["currencies"][k]).unwrap_or(0).max(0) as u32;
    }
    let mut langs = Vec::new();
    let mut profs = Vec::new();
    let mut senses = Vec::new();
    let mut initiative_bonus: i16 = 0;
    let mut armor_bonus: i16 = 0;
    for m in mods.iter().filter(|m| unrestricted(m)) {
        let subtype = text(&m["subType"]);
        let kind = text(&m["type"]);
        let bonus = modifier_value(m).unwrap_or(0).clamp(-100, 100) as i16;
        for (i, a) in ABILITIES.iter().enumerate() {
            if subtype == format!("{a}-saving-throws") {
                if kind == "proficiency" {
                    sheet.save_proficiencies[i] = true;
                }
                if kind == "bonus" {
                    sheet.save_bonuses[i] = sheet.save_bonuses[i].saturating_add(bonus);
                }
            }
            if subtype == "saving-throws" && kind == "bonus" {
                sheet.save_bonuses[i] = sheet.save_bonuses[i].saturating_add(bonus);
            }
        }
        for (i, skill) in SKILLS.iter().enumerate() {
            if subtype == *skill {
                if kind == "proficiency" {
                    if sheet.skill_ranks[i] != 2 {
                        sheet.skill_ranks[i] = 1;
                    }
                }
                if kind == "expertise" {
                    sheet.skill_ranks[i] = 2;
                }
                if kind == "half-proficiency" && sheet.skill_ranks[i] == 0 {
                    sheet.skill_ranks[i] = 3;
                }
                if kind == "bonus" {
                    sheet.skill_bonuses[i] = sheet.skill_bonuses[i].saturating_add(bonus);
                }
            }
            if kind == "bonus" && subtype == "ability-checks" {
                sheet.skill_bonuses[i] = sheet.skill_bonuses[i].saturating_add(bonus);
            }
        }
        let label = text(&m["friendlySubtypeName"]);
        let label = if label.is_empty() {
            subtype.replace('-', " ")
        } else {
            label.into()
        };
        if kind == "language" {
            langs.push(label.clone());
        }
        if kind == "proficiency" {
            profs.push(label.clone());
        }
        if kind == "sense" {
            senses.push(format!("{label} {} ft.", bonus));
        }
        if kind == "bonus" && subtype == "initiative" {
            initiative_bonus = initiative_bonus.saturating_add(bonus);
        }
        if kind == "bonus" && subtype == "armor-class" {
            armor_bonus = armor_bonus.saturating_add(bonus);
        }
    }
    for values in [&mut langs, &mut profs, &mut senses] {
        values.sort();
        values.dedup();
    }
    sheet.languages = langs.join(", ");
    sheet.proficiencies = profs.join(", ");
    sheet.senses = senses.join(", ");
    if initiative_bonus != 0 {
        sheet.initiative =
            Some((ability_modifier(abilities[1]) as i16).saturating_add(initiative_bonus));
    }
    let dex = ability_modifier(abilities[1]) as i16;
    let mut ac = 10 + dex;
    let mut shield = 0;
    let mut attacks = Vec::new();
    for item in arr(&data["inventory"])
        .iter()
        .filter(|i| i["equipped"] == true)
    {
        let definition = &item["definition"];
        if let Some(base) = number(&definition["armorClass"]).filter(|v| (0..=100).contains(v)) {
            match number(&definition["armorTypeId"]) {
                Some(1) => ac = base as i16 + dex,
                Some(2) => ac = base as i16 + dex.min(2),
                Some(3) => ac = base as i16,
                Some(4) => shield = base as i16,
                _ => {}
            }
        }
        let damage = text(&definition["damage"]["diceString"]);
        if !damage.is_empty() {
            attacks.push(format!(
                "{} | {} {} | attack bonus: review",
                name(item),
                damage,
                text(&definition["damageType"])
            ));
        }
    }
    sheet.armor_class = number(&data["armorClass"])
        .filter(|v| (-100..=100).contains(v))
        .map(|v| v as i16)
        .or(Some(
            ac.saturating_add(shield)
                .saturating_add(armor_bonus)
                .clamp(-100, 100),
        ));
    sheet.attacks = attacks.join("\n");
    sheet.hit_dice = arr(&data["classes"])
        .iter()
        .filter_map(|c| {
            number(&c["definition"]["hitDice"])
                .map(|dice| format!("{}d{}", number(&c["level"]).unwrap_or(1), dice))
        })
        .collect::<Vec<_>>()
        .join(" + ");
    let casting: HashSet<_> = arr(&data["classes"])
        .iter()
        .filter_map(|c| {
            number(&c["subclassDefinition"]["spellCastingAbilityId"])
                .or_else(|| number(&c["definition"]["spellCastingAbilityId"]))
        })
        .filter(|v| (1..=6).contains(v))
        .collect();
    if casting.len() == 1 {
        sheet.spell_ability = Some((*casting.iter().next().unwrap() - 1) as u8);
    }
    for slot in arr(&data["spellSlots"]) {
        if let Some(n) = number(&slot["level"]).filter(|v| (1..=9).contains(v)) {
            let i = n as usize - 1;
            sheet.spell_slots[i] = number(&slot["available"]).unwrap_or(0).clamp(0, 99) as u8;
            sheet.spell_slots_used[i] = number(&slot["used"]).unwrap_or(0).clamp(0, 99) as u8;
        }
    }
    for slot in arr(&data["pactMagic"]) {
        if let Some(n) = number(&slot["level"]).filter(|v| (1..=9).contains(v)) {
            sheet.pact_level = n as u8;
            sheet.pact_slots = number(&slot["available"]).unwrap_or(0).clamp(0, 99) as u8;
        }
    }
    let mut feature_lines = Vec::new();
    let mut add = |v: &Value| {
        if !name(v).is_empty() {
            let description = plain(text(&v["definition"]["description"]));
            feature_lines.push(if description.is_empty() {
                name(v).into()
            } else {
                format!("{}: {description}", name(v))
            });
        }
    };
    for v in arr(&data["feats"]) {
        add(v);
    }
    for c in arr(&data["classes"]) {
        for v in arr(&c["classFeatures"]) {
            if number(&v["definition"]["requiredLevel"]).unwrap_or(0)
                <= number(&c["level"]).unwrap_or(level as i64)
            {
                add(v);
            }
        }
    }
    for v in arr(&data["race"]["racialTraits"]) {
        add(v);
    }
    feature_lines.sort();
    feature_lines.dedup();
    sheet.features = feature_lines.join("\n\n");
    sheet.personality = plain(text(&data["traits"]["personalityTraits"]));
    sheet.ideals = plain(text(&data["traits"]["ideals"]));
    sheet.bonds = plain(text(&data["traits"]["bonds"]));
    sheet.flaws = plain(text(&data["traits"]["flaws"]));
    sheet.appearance = ["age", "height", "weight", "eyes", "skin", "hair"]
        .iter()
        .filter_map(|k| {
            let v = &data[k];
            if v.is_string() {
                Some(format!("{k}: {}", text(v)))
            } else if v.is_number() {
                Some(format!("{k}: {v}"))
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("; ");
    sheet.allies = plain(text(&data["notes"]["allies"]));
    sheet
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn sample() -> Value {
        json!({"id":123456,"name":"Ari","classes":[{"level":3,"definition":{"name":"Wizard"}}],"stats":[{"id":1,"value":8},{"id":2,"value":14},{"id":3,"value":14},{"id":4,"value":15},{"id":5,"value":12},{"id":6,"value":10}],"baseHitPoints":14,"race":{"fullName":"High Elf"},"modifiers":{"race":[{"id":"int","type":"bonus","subType":"intelligence-score","value":1}]}})
    }
    #[test]
    fn imports_extended_sheet_and_training_precedence() {
        let mut s = sample();
        s["classes"][0]["definition"]["hitDice"] = json!(6);
        s["classes"][0]["definition"]["spellCastingAbilityId"] = json!(4);
        s["race"]["weightSpeeds"] = json!({"normal":{"walk":30}});
        s["removedHitPoints"] = json!(4);
        s["temporaryHitPoints"] = json!(3);
        s["currencies"] = json!({"gp":42});
        s["spellSlots"] = json!([{"level":1,"available":4,"used":1}]);
        s["modifiers"]["background"] = json!([
            {"type":"half-proficiency","subType":"arcana"},
            {"type":"proficiency","subType":"arcana"},
            {"type":"expertise","subType":"stealth"},
            {"type":"proficiency","subType":"stealth"},
            {"type":"proficiency","subType":"intelligence-saving-throws"},
            {"type":"language","subType":"elvish","friendlySubtypeName":"Elvish"}
        ]);
        let c = parse(&s.to_string()).unwrap().character;
        assert_eq!(c.sheet.current_hp, Some(16));
        assert_eq!(c.sheet.temporary_hp, 3);
        assert_eq!(c.sheet.skill_ranks[2], 1);
        assert_eq!(c.sheet.skill_ranks[16], 2);
        assert!(c.sheet.save_proficiencies[3]);
        assert_eq!(c.sheet.languages, "Elvish");
        assert_eq!(c.sheet.hit_dice, "3d6");
        assert_eq!(c.sheet.spell_ability, Some(3));
        assert_eq!(c.sheet.spell_slots[0], 4);
        assert_eq!(c.sheet.spell_slots_used[0], 1);
        assert_eq!(c.sheet.currency[3], 42);
        assert_eq!(c.sheet.armor_class, Some(12));
        assert_eq!(c.sheet.speed, "30 ft.");
    }
    #[test]
    fn old_imports_are_enriched_without_overwriting_local_character_edits() {
        let c = parse(&sample().to_string()).unwrap().character;
        let mut value = serde_json::to_value(c).unwrap();
        value.as_object_mut().unwrap().remove("sheet");
        value["name"] = json!("My edited hero");
        value["hp"] = json!(33);
        let mut project = serde_json::to_value(Project::default()).unwrap();
        project["characters"] = json!([value]);
        let restored = crate::parse_project(&project.to_string()).unwrap();
        assert_eq!(restored.characters[0].name, "My edited hero");
        assert_eq!(restored.characters[0].hp, 33);
        assert_eq!(restored.characters[0].sheet.import_version, 1);
        assert_eq!(restored.characters[0].sheet.armor_class, Some(12));
        let mut value = serde_json::to_value(restored).unwrap();
        value["characters"][0]["sheet"]["armor_class"] = json!(18);
        let restored = crate::parse_project(&value.to_string()).unwrap();
        assert_eq!(restored.characters[0].sheet.armor_class, Some(18));
        value["characters"][0]["sheet"]["skill_ranks"][0] = json!(4);
        assert!(crate::parse_project(&value.to_string()).is_err());
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
