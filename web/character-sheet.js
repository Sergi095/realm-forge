export const abilityNames = [
  "Strength",
  "Dexterity",
  "Constitution",
  "Intelligence",
  "Wisdom",
  "Charisma",
];
export const skillList = [
  ["Acrobatics", 1],
  ["Animal Handling", 4],
  ["Arcana", 3],
  ["Athletics", 0],
  ["Deception", 5],
  ["History", 3],
  ["Insight", 4],
  ["Intimidation", 5],
  ["Investigation", 3],
  ["Medicine", 4],
  ["Nature", 3],
  ["Perception", 4],
  ["Performance", 5],
  ["Persuasion", 5],
  ["Religion", 3],
  ["Sleight of Hand", 1],
  ["Stealth", 1],
  ["Survival", 4],
];
export const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function sheetValues(c) {
  const s = c.sheet,
    mods = c.abilities.map((a) => Math.floor((a - 10) / 2)),
    pb = s.proficiency_bonus ?? 2 + Math.floor((c.level - 1) / 4);
  const skills = skillList.map(
    ([, a], i) =>
      mods[a] +
      (s.skill_ranks[i] === 3 ? Math.floor(pb / 2) : s.skill_ranks[i] * pb) +
      s.skill_bonuses[i],
  );
  return {
    mods,
    pb,
    skills,
    saves: mods.map(
      (m, i) => m + (s.save_proficiencies[i] ? pb : 0) + s.save_bonuses[i],
    ),
    initiative: s.initiative ?? mods[1],
    currentHp: s.current_hp ?? c.hp,
    passive: s.passive_perception ?? 10 + skills[11],
    spellDc:
      s.spell_dc ??
      (s.spell_ability === null ? null : 8 + pb + mods[s.spell_ability]),
    spellAttack:
      s.spell_attack ??
      (s.spell_ability === null ? null : pb + mods[s.spell_ability]),
  };
}
export function sheetSections(c) {
  const s = c.sheet;
  return [
    ["Attacks & actions", s.attacks],
    ["Features & traits", s.features],
    ["Proficiencies & training", s.proficiencies],
    ["Languages", s.languages],
    ["Senses", s.senses],
    ["Conditions", s.conditions],
    ["Equipment & inventory", c.inventory],
    ["Spells & abilities", c.spells],
    ["Personality", s.personality],
    ["Ideals", s.ideals],
    ["Bonds", s.bonds],
    ["Flaws", s.flaws],
    ["Appearance", s.appearance],
    ["Allies & organizations", s.allies],
    ["Backstory & notes", c.notes],
  ];
}
export function renderCharacterSheet(c) {
  const s = c.sheet,
    v = sheetValues(c),
    box = (label, value) =>
      `<div class="sheet-box"><small>${label}</small><strong>${esc(value ?? "—")}</strong></div>`;
  return `<article class="filled-sheet"><div class="filled-sheet-heading"><div><div class="eyebrow">D&D CHARACTER SHEET</div><h2>${esc(c.name)}</h2><p>${esc(c.ancestry || "Species not set")} · ${esc(c.class || "Class not set")} · Level ${c.level}</p></div><img class="sheet-seal" src="./assets/campaign-logo.svg" width="48" height="48" alt="" /></div><div class="sheet-meta">${box("Player", s.player || "—")}${box("Background", s.background || "—")}${box("Subclass", s.subclass || "—")}${box("Alignment", s.alignment || "—")}${box("Experience", s.xp)}${box("Size", s.size || "—")}</div><div class="sheet-abilities">${abilityNames.map((name, i) => `<div class="sheet-ability"><small>${name}</small><strong>${signed(v.mods[i])}</strong><span>${c.abilities[i]}</span></div>`).join("")}</div><div class="sheet-combat">${box("Armor Class", s.armor_class ?? "Set AC")}${box("Initiative", signed(v.initiative))}${box("Speed", s.speed || "Set speed")}${box("Proficiency", signed(v.pb))}${box("HP · current / max", `${v.currentHp} / ${c.hp}`)}${box("Temporary HP", s.temporary_hp)}${box("Hit dice", s.hit_dice || "—")}${box("Passive Perception", v.passive)}${box("Inspiration", s.inspiration ? "Yes" : "No")}${box("Death saves", `${s.death_successes} success · ${s.death_failures} failed`)}</div><div class="sheet-columns"><section><h3>Saving throws</h3>${abilityNames.map((name, i) => `<div class="sheet-row"><span>${s.save_proficiencies[i] ? "●" : "○"} ${name}</span><strong>${signed(v.saves[i])}</strong></div>`).join("")}<h3>Skills</h3>${skillList.map(([name, a], i) => `<div class="sheet-row"><span>${["○", "●", "◆", "◐"][s.skill_ranks[i]]} ${name} <small>${abilityNames[a].slice(0, 3).toUpperCase()}</small></span><strong>${signed(v.skills[i])}</strong></div>`).join("")}</section><section><h3>Spellcasting</h3><div class="sheet-combat">${box("Ability", s.spell_ability === null ? "Not set" : abilityNames[s.spell_ability])}${box("Save DC", v.spellDc)}${box("Attack bonus", v.spellAttack === null ? "—" : signed(v.spellAttack))}</div><div class="sheet-slots">${s.spell_slots.map((n, i) => `<div><small>Level ${i + 1}</small><strong>${Math.max(0, n - s.spell_slots_used[i])} / ${n}</strong></div>`).join("")}</div><p class="hint">Slots remaining / total · Pact magic: ${s.pact_slots} slots at level ${s.pact_level || "—"}</p><h3>Currency</h3><div class="sheet-currency">${["CP", "SP", "EP", "GP", "PP"].map((k, i) => box(k, s.currency[i])).join("")}</div>${sheetSections(
    c,
  )
    .slice(0, 6)
    .map(
      ([title, value]) =>
        `<h3>${title}</h3><p class="sheet-text">${esc(value || "Not recorded")}</p>`,
    )
    .join("")}</section></div><div class="sheet-notes">${sheetSections(c)
    .slice(6)
    .map(
      ([title, value]) =>
        `<section><h3>${title}</h3><p class="sheet-text">${esc(value || "Not recorded")}</p></section>`,
    )
    .join(
      "",
    )}</div><p class="hint">○ Untrained · ● Proficient · ◆ Expertise · ◐ Half proficiency. Check imported estimates and complete fields marked “Set”.</p></article>`;
}
export function renderSheetEditor(c) {
  const s = c.sheet,
    v = sheetValues(c);
  const input = (
    key,
    label,
    type = "text",
    min = "",
    max = "",
    placeholder = "",
  ) =>
    `<label>${label}<input name="sheet.${key}" type="${type}" value="${esc(s[key] ?? "")}" ${type === "number" ? `min="${min}" max="${max}" step="1"` : 'maxlength="2000"'} placeholder="${esc(placeholder)}"></label>`;
  const area = (key, label) =>
    `<label>${label}<textarea name="sheet.${key}" maxlength="100000">${esc(s[key])}</textarea></label>`;
  return `<h3>Identity & roleplaying</h3><div class="form-grid">${[
    ["player", "Player name"],
    ["background", "Background"],
    ["subclass", "Subclass"],
    ["alignment", "Alignment"],
    ["size", "Size"],
  ]
    .map(([k, l]) => input(k, l))
    .join(
      "",
    )}${input("xp", "Experience points", "number", 0, 4294967295)}<label class="check-label"><input name="sheet.inspiration" type="checkbox" ${s.inspiration ? "checked" : ""}> Inspiration</label></div><h3>Combat & health</h3><div class="form-grid">${input("armor_class", "Armor Class", "number", 0, 100, "Set your AC")}${input("initiative", "Initiative override", "number", -100, 100, `Auto: ${signed(v.mods[1])}`)}${input("speed", "Speed", "text", "", "", "e.g. 30 ft.; fly 60 ft.")}${input("current_hp", "Current HP", "number", 0, 65535, `Auto: ${c.hp}`)}${input("temporary_hp", "Temporary HP", "number", 0, 65535)}${input("hit_dice", "Hit dice", "text", "", "", "e.g. 3d8")}${input("death_successes", "Death save successes", "number", 0, 3)}${input("death_failures", "Death save failures", "number", 0, 3)}${input("proficiency_bonus", "Proficiency bonus override", "number", -100, 100, `Auto: +${2 + Math.floor((c.level - 1) / 4)}`)}${input("passive_perception", "Passive Perception override", "number", -100, 100, `Auto: ${10 + v.skills[11]}`)}${input("conditions", "Conditions")}${input("senses", "Senses")}</div><h3>Saving throws</h3><div class="sheet-training-editor">${abilityNames.map((name, i) => `<div class="training-row"><label class="check-label"><input type="checkbox" name="sheet.save_proficiencies.${i}" ${s.save_proficiencies[i] ? "checked" : ""}> ${name} save proficiency</label><input name="sheet.save_bonuses.${i}" type="number" min="-100" max="100" value="${s.save_bonuses[i]}" aria-label="${name} save extra bonus"></div>`).join("")}</div><h3>Skills</h3><p class="hint">Choose training; the sheet calculates ability + proficiency + your extra bonus.</p><div class="sheet-training-editor">${skillList.map(([name], i) => `<div class="training-row"><label>${name}<select name="sheet.skill_ranks.${i}" aria-label="${name} proficiency">${["Untrained", "Proficient", "Expertise", "Half proficiency"].map((label, rank) => `<option value="${rank}" ${s.skill_ranks[i] === rank ? "selected" : ""}>${label}</option>`).join("")}</select></label><input name="sheet.skill_bonuses.${i}" type="number" min="-100" max="100" value="${s.skill_bonuses[i]}" aria-label="${name} extra bonus"></div>`).join("")}</div><h3>Attacks, features & training</h3><div class="form-grid">${area("attacks", "Attacks & actions (name, attack bonus, damage, notes)")}${area("features", "Features & traits")}${area("proficiencies", "Armor, weapons, tools & other training")}${input("languages", "Languages")}</div><h3>Spellcasting & slots</h3><div class="form-grid"><label>Spellcasting ability<select name="sheet.spell_ability" aria-label="Spellcasting ability"><option value="">Not set / no spellcasting</option>${abilityNames.map((name, i) => `<option value="${i}" ${s.spell_ability === i ? "selected" : ""}>${name}</option>`).join("")}</select></label>${input("spell_dc", "Spell save DC override", "number", -100, 100, "Auto from spellcasting ability")}${input("spell_attack", "Spell attack bonus override", "number", -100, 100, "Auto from spellcasting ability")}${input("pact_slots", "Pact magic slots", "number", 0, 99)}${input("pact_level", "Pact magic slot level", "number", 0, 9)}</div><div class="slot-editor">${s.spell_slots.map((n, i) => `<fieldset><legend>Spell level ${i + 1}</legend><label>Total<input type="number" min="0" max="99" name="sheet.spell_slots.${i}" value="${n}" aria-label="Level ${i + 1} spell slots total"></label><label>Used<input type="number" min="0" max="99" name="sheet.spell_slots_used.${i}" value="${s.spell_slots_used[i]}" aria-label="Level ${i + 1} spell slots used"></label></fieldset>`).join("")}</div><h3>Currency</h3><div class="currency-editor">${["Copper", "Silver", "Electrum", "Gold", "Platinum"].map((name, i) => `<label>${name}<input name="sheet.currency.${i}" type="number" min="0" max="4294967295" value="${s.currency[i]}"></label>`).join("")}</div><h3>Personality & story</h3><div class="form-grid">${[
    ["personality", "Personality traits"],
    ["ideals", "Ideals"],
    ["bonds", "Bonds"],
    ["flaws", "Flaws"],
    ["appearance", "Appearance"],
    ["allies", "Allies & organizations"],
  ]
    .map(([k, l]) => area(k, l))
    .join("")}</div>`;
}
export function readSheetForm(form, c) {
  const result = structuredClone(c.sheet);
  for (const field of form.querySelectorAll('[name^="sheet."]')) {
    const [, key, index] = field.name.split(".");
    let value =
      field.type === "checkbox"
        ? field.checked
        : field.type === "number" ||
            key === "spell_ability" ||
            key === "skill_ranks"
          ? field.value === ""
            ? null
            : Number(field.value)
          : field.value;
    if (index !== undefined) {
      result[key][Number(index)] = value ?? 0;
    } else
      result[key] =
        value === null &&
        ![
          "armor_class",
          "initiative",
          "current_hp",
          "proficiency_bonus",
          "passive_perception",
          "spell_ability",
          "spell_dc",
          "spell_attack",
        ].includes(key)
          ? 0
          : value;
  }
  result.import_version = 1;
  return result;
}
