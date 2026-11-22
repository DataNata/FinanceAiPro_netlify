/** Простой генератор Word (.docx): заголовки, абзацы, списки, таблицы с заливкой ячеек. Без внешних библиотек. */
import { zip, xmlEsc } from "./zip.js";

const CM = 567;   // twips в сантиметре

function run(r) {
  const o = typeof r === "string" ? { text: r } : r;
  const pr = (o.bold ? "<w:b/>" : "") + (o.color ? `<w:color w:val="${o.color}"/>` : "") + (o.size ? `<w:sz w:val="${o.size * 2}"/>` : "");
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEsc(o.text)}</w:t></w:r>`;
}

export class Doc {
  constructor() { this.body = []; }
  heading(text, level = 1) { this.body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${run(text)}</w:p>`); return this; }
  /** runs: строка или [{text, bold, color, size}] */
  para(runs = "", opts = {}) {
    const list = Array.isArray(runs) ? runs : [{ text: runs, ...opts }];
    this.body.push(`<w:p>${list.map(run).join("")}</w:p>`);
    return this;
  }
  bullets(lines) {
    for (const l of lines) if (l) this.body.push(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:ind w:left="360" w:hanging="240"/></w:pPr>${run("• " + l)}</w:p>`);
    return this;
  }
  /** header: [строки], rows: [[ячейки]], fills: (rowIdx, colIdx, value) → цвет | null, widths — см. */
  table(header, rows, { fill = null, widths = null, size = 9 } = {}) {
    const total = (widths || header.map(() => 17.4 / header.length)).map((w) => Math.round(w * CM));
    const cell = (text, w, color, bold) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>` +
      (color ? `<w:shd w:val="clear" w:color="auto" w:fill="${color}"/>` : "") + `</w:tcPr>` +
      String(text ?? "").split("\n").map((line) => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run({ text: line, bold, size })}</w:p>`).join("") +
      `</w:tc>`;
    let x = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>` +
      `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join("")}</w:tblBorders>` +
      `<w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${total.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
    x += `<w:tr>${header.map((h, i) => cell(h, total[i], "D9E1F2", true)).join("")}</w:tr>`;
    rows.forEach((row, ri) => {
      x += `<w:tr>${row.map((v, ci) => cell(v, total[ci], fill ? fill(ri, ci, v) : null, false)).join("")}</w:tr>`;
    });
    this.body.push(x + `</w:tbl>`, "<w:p/>");
    return this;
  }
  toBytes() {
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${this.body.join("")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="1020" w:bottom="850" w:left="1020" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const font = `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>`;
    const heading = (lvl, size, color) => `<w:style w:type="paragraph" w:styleId="Heading${lvl}"><w:name w:val="heading ${lvl}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="${lvl === 1 ? 240 : 180}" w:after="80"/><w:outlineLvl w:val="${lvl - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="20"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading(1, 32, "1F3864")}${heading(2, 26, "2F5496")}${heading(3, 22, "2F5496")}
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
    return zip([
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
      ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["word/document.xml", doc],
      ["word/styles.xml", styles],
    ]);
  }
}
