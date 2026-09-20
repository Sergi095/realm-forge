use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CharacterSheet {
    pub import_version: u8,
    pub player: String,
    pub background: String,
    pub subclass: String,
    pub alignment: String,
    pub size: String,
    pub xp: u32,
    pub inspiration: bool,
    pub armor_class: Option<i16>,
    pub initiative: Option<i16>,
    pub speed: String,
    pub current_hp: Option<u16>,
    pub temporary_hp: u16,
    pub hit_dice: String,
    pub death_successes: u8,
    pub death_failures: u8,
    pub proficiency_bonus: Option<i16>,
    pub save_proficiencies: [bool; 6],
    pub save_bonuses: [i16; 6],
    // 0 = untrained, 1 = proficient, 2 = expertise, 3 = half proficiency.
    pub skill_ranks: [u8; 18],
    pub skill_bonuses: [i16; 18],
    pub passive_perception: Option<i16>,
    pub attacks: String,
    pub features: String,
    pub proficiencies: String,
    pub languages: String,
    pub senses: String,
    pub conditions: String,
    pub personality: String,
    pub ideals: String,
    pub bonds: String,
    pub flaws: String,
    pub appearance: String,
    pub allies: String,
    // CP, SP, EP, GP, PP.
    pub currency: [u32; 5],
    pub spell_ability: Option<u8>,
    pub spell_dc: Option<i16>,
    pub spell_attack: Option<i16>,
    pub spell_slots: [u8; 9],
    pub spell_slots_used: [u8; 9],
    pub pact_slots: u8,
    pub pact_level: u8,
}
impl CharacterSheet {
    pub fn validate(&self) -> Result<(), String> {
        if self.import_version > 1
            || self.death_successes > 3
            || self.death_failures > 3
            || self.skill_ranks.iter().any(|v| *v > 3)
            || self.spell_ability.is_some_and(|v| v > 5)
            || self
                .spell_slots
                .iter()
                .chain(self.spell_slots_used.iter())
                .any(|v| *v > 99)
            || self.pact_slots > 99
            || self.pact_level > 9
            || self
                .save_bonuses
                .iter()
                .chain(self.skill_bonuses.iter())
                .any(|v| !(-100..=100).contains(v))
            || [
                self.armor_class,
                self.initiative,
                self.proficiency_bonus,
                self.passive_perception,
                self.spell_dc,
                self.spell_attack,
            ]
            .iter()
            .flatten()
            .any(|v| !(-100..=100).contains(v))
            || [
                &self.player,
                &self.background,
                &self.subclass,
                &self.alignment,
                &self.size,
                &self.speed,
                &self.hit_dice,
                &self.languages,
                &self.senses,
                &self.conditions,
            ]
            .iter()
            .any(|v| v.len() > 2000)
            || [
                &self.attacks,
                &self.features,
                &self.proficiencies,
                &self.personality,
                &self.ideals,
                &self.bonds,
                &self.flaws,
                &self.appearance,
                &self.allies,
            ]
            .iter()
            .any(|v| v.len() > 100_000)
        {
            return Err("Invalid character sheet fields or proficiency values.".into());
        }
        Ok(())
    }
}
