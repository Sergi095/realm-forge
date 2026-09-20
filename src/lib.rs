mod ddb;
mod material_catalog;
mod printing;
use material_catalog::MATERIAL_COUNT;
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
pub struct Block {
    pub x: usize,
    pub y: usize,
    pub z: u8,
    pub material: u16,
}
fn default_elevations() -> Vec<u8> {
    vec![0; 40 * 28]
}
fn default_scale() -> f64 {
    1.524
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
    #[serde(default = "default_elevations")]
    pub elevations: Vec<u8>,
    #[serde(default)]
    pub blocks: Vec<Block>,
    #[serde(default = "default_scale")]
    pub meters_per_tile: f64,
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
            elevations: default_elevations(),
            blocks: vec![],
            meters_per_tile: default_scale(),
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
        if self.elevations.len() != self.tiles.len()
            || self.elevations.iter().any(|v| *v > 24)
            || !self.meters_per_tile.is_finite()
            || !(0.1..=100_000.0).contains(&self.meters_per_tile)
        {
            return Err("Invalid terrain elevation or world scale.".into());
        }
        let mut occupied = std::collections::HashSet::new();
        if self.blocks.len() > 12_000
            || self.blocks.iter().any(|b| {
                b.x >= self.width
                    || b.y >= self.height
                    || b.z > 63
                    || b.material >= MATERIAL_COUNT
                    || !occupied.insert((b.x, b.y, b.z))
            })
        {
            return Err("Invalid or duplicate building blocks. A world can hold up to 12,000 blocks, at heights 0–63.".into());
        }
        if self.tiles.iter().any(|t| *t > 11) {
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
    pub fn export_stl(
        &self,
        width_mm: f32,
        base_mm: f32,
        relief: f32,
        trees: bool,
        pins: bool,
    ) -> Result<Vec<u8>, JsValue> {
        printing::export(&self.project, width_mm, base_mm, relief, trees, pins)
            .map_err(|e| JsValue::from_str(&e))
    }
    pub fn export_stl_section(
        &self,
        tile_mm: f32,
        base_mm: f32,
        relief: f32,
        trees: bool,
        pins: bool,
        x: usize,
        y: usize,
        width: usize,
        height: usize,
    ) -> Result<Vec<u8>, JsValue> {
        printing::export_section(
            &self.project,
            tile_mm,
            base_mm,
            relief,
            trees,
            pins,
            x,
            y,
            width,
            height,
        )
        .map_err(|e| JsValue::from_str(&e))
    }
    pub fn export_print_model_section(
        &self,
        tile_mm: f32,
        base_mm: f32,
        relief: f32,
        trees: bool,
        pins: bool,
        x: usize,
        y: usize,
        width: usize,
        height: usize,
    ) -> Result<String, JsValue> {
        printing::export_model(
            &self.project,
            tile_mm,
            base_mm,
            relief,
            trees,
            pins,
            x,
            y,
            width,
            height,
        )
        .map_err(|e| JsValue::from_str(&e))
    }
    pub fn brush(&mut self, x: usize, y: usize, size: usize, terrain: u8, tool: u8) -> bool {
        if x >= 40 || y >= 28 || ![1, 3, 5, 9].contains(&size) || terrain > 11 || tool > 3 {
            return false;
        }
        let radius = size / 2;
        let mut changed = false;
        for yy in y.saturating_sub(radius)..=(y + radius).min(27) {
            for xx in x.saturating_sub(radius)..=(x + radius).min(39) {
                let i = yy * 40 + xx;
                if tool == 0 {
                    if self.project.tiles[i] != terrain {
                        self.project.tiles[i] = terrain;
                        changed = true;
                    }
                } else {
                    let old = self.project.elevations[i];
                    self.project.elevations[i] = match tool {
                        1 => (old + 1).min(24),
                        2 => old.saturating_sub(1),
                        _ => 0,
                    };
                    changed |= old != self.project.elevations[i];
                }
            }
        }
        changed
    }
    pub fn place_block(&mut self, x: usize, y: usize, z: u8, material: u16) -> bool {
        if x >= 40 || y >= 28 || z > 63 || material >= MATERIAL_COUNT {
            return false;
        }
        if let Some(block) = self
            .project
            .blocks
            .iter_mut()
            .find(|b| b.x == x && b.y == y && b.z == z)
        {
            let changed = block.material != material;
            block.material = material;
            return changed;
        }
        if self.project.blocks.len() >= 12_000 {
            return false;
        }
        self.project.blocks.push(Block { x, y, z, material });
        true
    }
    pub fn remove_block(&mut self, x: usize, y: usize, z: u8) -> bool {
        if let Some(i) = self
            .project
            .blocks
            .iter()
            .position(|b| b.x == x && b.y == y && b.z == z)
        {
            self.project.blocks.remove(i);
            true
        } else {
            false
        }
    }
    pub fn paint(&mut self, x: usize, y: usize, terrain: u8) -> bool {
        if x >= self.project.width || y >= self.project.height || terrain > 11 {
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
    fn entire_material_catalog_is_supported_and_saved() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../web/minecraft-catalog.json")).unwrap();
        assert_eq!(
            catalog["blocks"].as_array().unwrap().len() + 24,
            MATERIAL_COUNT as usize
        );
        let mut r = Realm::new();
        assert!(r.place_block(2, 3, 4, MATERIAL_COUNT - 1));
        let saved = r.snapshot();
        let mut restored = Realm::new();
        restored.restore(&saved).unwrap();
        assert_eq!(restored.project.blocks[0].material, MATERIAL_COUNT - 1);
    }
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
        assert!(!r.paint(0, 0, 12));
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
    #[test]
    fn old_worlds_gain_scale_and_building_defaults() {
        let mut v = serde_json::to_value(Project::default()).unwrap();
        for key in ["elevations", "blocks", "meters_per_tile"] {
            v.as_object_mut().unwrap().remove(key);
        }
        let p = parse_project(&v.to_string()).unwrap();
        assert_eq!(p.meters_per_tile, 1.524);
        assert_eq!(p.elevations.len(), 1120);
        assert!(p.blocks.is_empty());
    }
    #[test]
    fn building_and_brush_operations_remain_bounded() {
        let mut r = Realm::new();
        assert!(r.place_block(0, 0, 0, 23));
        assert!(!r.place_block(40, 0, 0, 0));
        assert!(!r.place_block(0, 0, 64, 0));
        assert!(!r.place_block(0, 0, 0, MATERIAL_COUNT));
        assert!(r.place_block(1, 0, 0, MATERIAL_COUNT - 1));
        assert!(r.remove_block(0, 0, 0));
        assert!(!r.remove_block(0, 0, 0));
        assert!(r.brush(0, 0, 3, 7, 0));
        assert_eq!(r.project.tiles.iter().filter(|t| **t == 7).count(), 4);
        for _ in 0..30 {
            r.brush(0, 0, 1, 0, 1);
        }
        assert_eq!(r.project.elevations[0], 24);
        r.project.validate().unwrap();
    }
}
