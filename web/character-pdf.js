import { PDFDocument, rgb } from "./vendor/pdf-lib.js";
import fontkit from "./vendor/fontkit.js";
import {
  abilityNames,
  skillList,
  sheetValues,
  sheetSections,
  signed,
} from "./character-sheet.js";

// An original, printer-friendly sheet. All generation stays in the browser.
export async function characterPdf(c) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = await Promise.all(
    ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map(async (name) => {
      const response = await fetch(new URL(`./fonts/${name}`, import.meta.url));
      if (!response.ok)
        throw new Error("Could not load the PDF font. Please retry.");
      return doc.embedFont(await response.arrayBuffer(), { subset: true });
    }),
  );
  const [regular, bold] = fonts;
  const supported = new Set(regular.getCharacterSet());
  const clean = (value) =>
    Array.from(
      String(value ?? "—")
        .replace(/\t/g, "    ")
        .replace(/\r/g, ""),
    )
      .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0)) ? ch : "□"))
      .join("");
  const width = 595.28,
    height = 841.89,
    margin = 34,
    content = width - margin * 2;
  const ink = rgb(0.12, 0.12, 0.15),
    muted = rgb(0.36, 0.36, 0.4),
    line = rgb(0.72, 0.72, 0.75),
    tint = rgb(0.96, 0.96, 0.97);
  let page, y;
  const text = (value, x, top, size = 10, font = regular, color = ink) =>
    page.drawText(clean(value), {
      x,
      y: height - top - size,
      size,
      font,
      color,
    });
  const wrap = (value, max, size = 10, font = regular) => {
    const lines = [];
    for (const paragraph of clean(value).split("\n")) {
      let current = "";
      for (const word of paragraph.split(/ +/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= max) {
          current = candidate;
          continue;
        }
        if (current) {
          lines.push(current);
          current = "";
        }
        for (const ch of word) {
          if (current && font.widthOfTextAtSize(current + ch, size) > max) {
            lines.push(current);
            current = "";
          }
          current += ch;
        }
      }
      lines.push(current);
    }
    return lines;
  };
  const newPage = () => {
    page = doc.addPage([width, height]);
    y = 34;
    text("DND CAMPAIGN BUILDING", margin, y, 8, bold, muted);
    text("CHARACTER SHEET", width - 139, y, 8, bold, muted);
    y += 22;
  };
  const box = (label, value, x, top, w, h = 49) => {
    page.drawRectangle({
      x,
      y: height - top - h,
      width: w,
      height: h,
      borderColor: line,
      borderWidth: 0.6,
      color: tint,
    });
    text(label, x + 8, top + 7, 7, bold, muted);
    let size = 13;
    const v = clean(value);
    while (size > 6 && regular.widthOfTextAtSize(v, size) > w - 16) size -= 0.5;
    // Long metadata is printed unabridged on the following pages as well.
    const lines = wrap(v, w - 16, size);
    text(lines[0], x + 8, top + 22, size);
    if (lines.length > 1)
      text("See character details", x + 8, top + h - 10, 6, regular, muted);
  };
  const heading = (label) => {
    if (y > height - 90) newPage();
    text(label, margin, y, 12, bold);
    y += 22;
  };
  const paragraph = (value, size = 10) => {
    for (const l of wrap(value || "Not recorded", content, size)) {
      if (y > height - 54) newPage();
      text(l, margin, y, size);
      y += size + 5;
    }
    y += 9;
  };
  const s = c.sheet,
    v = sheetValues(c);
  newPage();
  for (const l of wrap(c.name, content, 23, bold)) {
    text(l, margin, y, 23, bold);
    y += 29;
  }
  paragraph(
    `${c.ancestry || "Species not set"} · ${c.class || "Class not set"} · Level ${c.level}`,
    10,
  );
  // Keep the entire statistics grid together, even for unusually long names.
  if (y > 150) newPage();
  const gap = 8,
    col = (content - gap * 2) / 3;
  [
    ["Background", s.background || "Not set"],
    ["Subclass", s.subclass || "Not set"],
    ["Alignment", s.alignment || "Not set"],
  ].forEach(([l, val], i) => box(l, val, margin + i * (col + gap), y, col));
  y += 59;
  const aw = (content - gap * 5) / 6;
  abilityNames.forEach((name, i) =>
    box(
      name.toUpperCase(),
      `${c.abilities[i]}  (${signed(v.mods[i])})`,
      margin + i * (aw + gap),
      y,
      aw,
      52,
    ),
  );
  y += 62;
  const cw = (content - gap * 3) / 4;
  const combat = [
    ["ARMOR CLASS", s.armor_class ?? "Set AC"],
    ["INITIATIVE", signed(v.initiative)],
    ["SPEED", s.speed || "Set speed"],
    ["PROFICIENCY", signed(v.pb)],
    ["HP · CURRENT / MAX", `${v.currentHp} / ${c.hp}`],
    ["TEMPORARY HP", s.temporary_hp],
    ["HIT DICE", s.hit_dice || "Not set"],
    ["PASSIVE PERCEPTION", v.passive],
  ];
  combat.forEach(([l, val], i) =>
    box(l, val, margin + (i % 4) * (cw + gap), y + Math.floor(i / 4) * 59, cw),
  );
  y += 118;
  const left = margin,
    right = margin + 270,
    rowsY = y + 26;
  text("SKILLS", left, y, 11, bold);
  text("SAVING THROWS", right, y, 11, bold);
  skillList.forEach(([name, a], i) => {
    const top = rowsY + i * 17;
    text(["○", "●", "◆", "◐"][s.skill_ranks[i]], left, top, 9);
    text(`${name} (${abilityNames[a].slice(0, 3)})`, left + 15, top, 9);
    text(signed(v.skills[i]), left + 223, top, 10, bold);
  });
  abilityNames.forEach((name, i) => {
    text(
      `${s.save_proficiencies[i] ? "●" : "○"} ${name}`,
      right,
      rowsY + i * 20,
      10,
    );
    text(signed(v.saves[i]), right + 210, rowsY + i * 20, 10, bold);
  });
  let ry = rowsY + 142;
  for (const [label, value] of [
    ["INSPIRATION", s.inspiration ? "Yes" : "No"],
    [
      "DEATH SAVES",
      `${s.death_successes} successes / ${s.death_failures} failures`,
    ],
    [
      "SPELLCASTING",
      s.spell_ability === null ? "Not set" : abilityNames[s.spell_ability],
    ],
    [
      "SPELL SAVE DC / ATTACK",
      `${v.spellDc ?? "—"} / ${v.spellAttack === null ? "—" : signed(v.spellAttack)}`,
    ],
  ]) {
    box(label, value, right, ry, content - 270, 39);
    ry += 45;
  }
  y = Math.max(rowsY + 18 * 17, ry) + 15;
  text(
    "○ Untrained   ● Proficient   ◆ Expertise   ◐ Half proficiency",
    margin,
    y,
    8,
    regular,
    muted,
  );
  y += 18;
  text(
    "Check imported estimates and complete fields marked “Set”.",
    margin,
    y,
    8,
    regular,
    muted,
  );
  newPage();
  heading("Character details");
  for (const [label, value] of [
    ["Name", c.name],
    ["Player", s.player],
    ["Species", c.ancestry],
    ["Class", c.class],
    ["Level", c.level],
    ["Background", s.background],
    ["Subclass", s.subclass],
    ["Alignment", s.alignment],
    ["Experience", s.xp],
    ["Size", s.size],
    ["Speed", s.speed],
    ["Hit dice", s.hit_dice],
  ])
    paragraph(`${label}: ${value || "Not recorded"}`);
  heading("Spell slots · remaining / total");
  paragraph(
    s.spell_slots
      .map(
        (n, i) =>
          `Level ${i + 1}: ${Math.max(0, n - s.spell_slots_used[i])} / ${n} (${s.spell_slots_used[i]} used)`,
      )
      .join("\n"),
  );
  paragraph(
    `Pact magic: ${s.pact_slots} slots at level ${s.pact_level || "not set"}`,
  );
  heading("Currency");
  paragraph(
    ["CP", "SP", "EP", "GP", "PP"]
      .map((k, i) => `${s.currency[i]} ${k}`)
      .join("     "),
  );
  for (const [label, value] of sheetSections(c)) {
    heading(label);
    paragraph(value);
  }
  if (c.source) {
    heading("Import notes");
    paragraph(
      `D&D Beyond character ${c.source.id}. One-time imported copy.\n${c.source.warnings.join("\n")}`,
    );
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    text(
      `DND Campaign Building · ${i + 1} / ${pages.length}`,
      margin,
      height - 28,
      8,
      regular,
      muted,
    );
  });
  doc.setTitle(`${c.name} — Character sheet`);
  doc.setCreator("DND Campaign Building");
  return doc.save();
}
export async function downloadCharacterPdf(c) {
  const bytes = await characterPdf(c);
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${
    c.name
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 80) || "character"
  }-sheet.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
