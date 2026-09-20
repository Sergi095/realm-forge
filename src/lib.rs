mod ddb;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Character {
    pub name: String,
    pub ancestry: String,
    pub class: String,
    pub level: u8,
    pub hp: u16,
    pub abilities: [u8; 6],
    pub notes: String,
    pub inventory: String,
    pub spells: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ImportedSource>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedSource {
    pub kind: String,
    pub id: u64,
    pub original: String,
    pub warnings: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pin {
    pub x: usize,
    pub y: usize,
    pub name: String,
    pub notes: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub version: u8,
    pub title: String,
    pub lore: String,
    pub characters: Vec<Character>,
    pub width: usize,
    pub height: usize,
    pub tiles: Vec<u8>,
    pub pins: Vec<Pin>,
}
impl Default for Project {
    fn default() -> Self {
        Self {
            version: 1,
            title: "My first realm".into(),
            lore: String::new(),
            characters: vec![],
            width: 40,
            height: 28,
            tiles: vec![0; 40 * 28],
            pins: vec![],
        }
    }
}
impl Project {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("This backup uses an unsupported save version.".into());
        }
        if self.width != 40 || self.height != 28 || self.tiles.len() != self.width * self.height {
            return Err("Invalid map dimensions.".into());
        }
        if self.tiles.iter().any(|t| *t > 5) {
            return Err("Unknown terrain in map.".into());
        }
        if self.characters.len() > 100 || self.pins.len() > 500 {
            return Err("Too many characters or locations.".into());
        }
        if self.title.trim().is_empty() || self.title.len() > 200 || self.lore.len() > 100_000 {
            return Err(
                "Give your realm a title (up to 200 bytes); lore can hold up to 100,000 bytes."
                    .into(),
            );
        }
        for c in &self.characters {
            if let Some(source) = &c.source {
                if source.kind != "dndbeyond"
                    || source.id == 0
                    || source.original.len() > 2_000_000
                    || source.warnings.len() > 50
                    || source.warnings.iter().any(|w| w.len() > 2000)
                    || serde_json::from_str::<serde_json::Value>(&source.original).is_err()
                {
                    return Err("Invalid imported character source.".into());
                }
            }
            if c.name.trim().is_empty()
                || c.name.len() > 200
                || c.ancestry.len() > 200
                || c.class.len() > 200
                || !(1..=20).contains(&c.level)
                || c.abilities.iter().any(|a| !(1..=30).contains(a))
                || [&c.notes, &c.inventory, &c.spells]
                    .iter()
                    .any(|s| s.len() > 100_000)
            {
                return Err(
                    "Character fields are invalid. Use levels 1–20 and ability scores 1–30.".into(),
                );
            }
        }
        for p in &self.pins {
            if p.x >= self.width
                || p.y >= self.height
                || p.name.trim().is_empty()
                || p.name.len() > 200
                || p.notes.len() > 100_000
            {
                return Err("A location has invalid coordinates or text.".into());
            }
        }
        Ok(())
    }
}
fn parse_project(json: &str) -> Result<Project, String> {
    if json.len() > 5_000_000 {
        return Err("Backup is larger than 5 MB.".into());
    }
    let p: Project = serde_json::from_str(json).map_err(|e| format!("Invalid backup: {e}"))?;
    p.validate()?;
    Ok(p)
}
#[wasm_bindgen]
pub struct Realm {
    project: Project,
}
#[wasm_bindgen]
impl Realm {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            project: Project::default(),
        }
    }
    pub fn snapshot(&self) -> String {
        serde_json::to_string(&self.project).unwrap()
    }
    pub fn restore(&mut self, json: &str) -> Result<(), JsValue> {
        self.project = parse_project(json).map_err(|e| JsValue::from_str(&e))?;
        Ok(())
    }
    pub fn paint(&mut self, x: usize, y: usize, terrain: u8) -> bool {
        if x >= self.project.width || y >= self.project.height || terrain > 5 {
            return false;
        }
        let tile = &mut self.project.tiles[y * self.project.width + x];
        if *tile == terrain {
            return false;
        }
        *tile = terrain;
        true
    }
    pub fn generate(&mut self, seed: u32) {
        let mut n = seed.max(1);
        for y in 0..self.project.height {
            for x in 0..self.project.width {
                n ^= n << 13;
                n ^= n >> 17;
                n ^= n << 5;
                let dx = (x as f64 - 19.5) / 19.5;
                let dy = (y as f64 - 13.5) / 13.5;
                let elevation = 1.0 - dx * dx - dy * dy + (n % 100) as f64 / 250.0;
                self.project.tiles[y * self.project.width + x] = if elevation < 0.18 {
                    1
                } else if elevation < 0.35 {
                    4
                } else if elevation > 0.95 && n % 3 == 0 {
                    3
                } else if n % 4 == 0 {
                    2
                } else {
                    0
                };
            }
        }
    }
}
impl Default for Realm {
    fn default() -> Self {
        Self::new()
    }
}
#[wasm_bindgen]
pub fn ability_modifier(score: u8) -> i16 {
    (i16::from(score) - 10).div_euclid(2)
}

#[wasm_bindgen]
pub fn preview_ddb(json: &str) -> Result<String, JsValue> {
    let preview = ddb::parse(json).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&preview).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip() {
        let p = Project::default();
        assert!(parse_project(&serde_json::to_string(&p).unwrap()).is_ok());
    }
    #[test]
    fn bad_map_rejected() {
        let mut p = Project::default();
        p.tiles.pop();
        assert!(p.validate().is_err());
    }
    #[test]
    fn bounds_and_generation() {
        let mut r = Realm::new();
        assert!(!r.paint(40, 0, 1));
        assert!(!r.paint(0, 0, 6));
        r.generate(42);
        r.project.validate().unwrap();
        let s = r.snapshot();
        r.generate(42);
        assert_eq!(r.snapshot(), s);
    }
    #[test]
    fn odd_negative_modifiers() {
        assert_eq!(ability_modifier(9), -1);
        assert_eq!(ability_modifier(7), -2);
        assert_eq!(ability_modifier(18), 4);
    }
    #[test]
    fn unsupported_version() {
        let mut p = Project::default();
        p.version = 2;
        assert!(p.validate().is_err());
    }
    #[test]
    fn hostile_pin_rejected() {
        let mut p = Project::default();
        p.pins.push(Pin {
            x: 100,
            y: 0,
            name: "x".into(),
            notes: "".into(),
        });
        assert!(p.validate().is_err());
    }
}
