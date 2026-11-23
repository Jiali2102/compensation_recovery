import JSZip from "jszip";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chartXml(spec, chartId) {
  const kind = spec.type === "line" ? "lineChart" : "barChart";
  const axId1 = 100000000 + chartId * 2;
  const axId2 = axId1 + 1;
  const grouping = spec.type === "line" ? "standard" : "clustered";
  const barDir = spec.type === "line" ? "" : '<c:barDir val="col"/>';
  const marker = spec.type === "line" ? "<c:marker><c:symbol val=\"circle\"/><c:size val=\"5\"/></c:marker>" : "";
  const title = spec.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
    : '<c:autoTitleDeleted val="1"/>';
  const nameTag = spec.nameRef ? `<c:tx><c:strRef><c:f>${esc(spec.nameRef)}</c:f></c:strRef></c:tx>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
${title}
<c:plotArea>
<c:layout/>
<c:${kind}>
${barDir}
<c:grouping val="${grouping}"/>
<c:varyColors val="0"/>
<c:ser>
<c:idx val="0"/>
<c:order val="0"/>
${nameTag}
${marker}
<c:cat><c:strRef><c:f>${esc(spec.catRef)}</c:f></c:strRef></c:cat>
<c:val><c:numRef><c:f>${esc(spec.valRef)}</c:f></c:numRef></c:val>
</c:ser>
<c:axId val="${axId1}"/>
<c:axId val="${axId2}"/>
</c:${kind}>
<c:catAx>
<c:axId val="${axId1}"/>
<c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/>
<c:axPos val="b"/>
<c:crossAx val="${axId2}"/>
</c:catAx>
<c:valAx>
<c:axId val="${axId2}"/>
<c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/>
<c:axPos val="l"/>
<c:crossAx val="${axId1}"/>
</c:valAx>
</c:plotArea>
<c:plotVisOnly val="1"/>
</c:chart>
</c:chartSpace>`;
}

function drawingXml(chartRelId, anchor) {
  const a = anchor || { fromCol: 6, fromRow: 2, toCol: 14, toRow: 20 };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor>
<xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr>
<xdr:cNvPr id="2" name="Chart 1"/>
<xdr:cNvGraphicFramePr/>
</xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic>
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRelId}"/>
</a:graphicData>
</a:graphic>
</xdr:graphicFrame>
<xdr:clientData/>
</xdr:twoCellAnchor>
</xdr:wsDr>`;
}

const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

export async function injectCharts(buffer, specs) {
  if (!specs || !specs.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const ctPath = "[Content_Types].xml";
  let ct = await zip.file(ctPath).async("string");
  const ctOverrides = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const chartId = i + 1;
    const sheetPath = `xl/worksheets/sheet${spec.sheetIndex}.xml`;
    const sheetRelsPath = `xl/worksheets/_rels/sheet${spec.sheetIndex}.xml.rels`;
    const drawingName = `drawing${chartId}.xml`;
    const chartName = `chart${chartId}.xml`;

    zip.file(`xl/charts/${chartName}`, chartXml(spec, chartId));
    zip.file(`xl/drawings/${drawingName}`, drawingXml("rId1", spec.anchor));
    zip.file(
      `xl/drawings/_rels/${drawingName}.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships ${RELS_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/${chartName}"/></Relationships>`
    );

    let sheetRels = null;
    const relsFile = zip.file(sheetRelsPath);
    if (relsFile) sheetRels = await relsFile.async("string");
    let drawingRid;
    if (sheetRels) {
      const ids = [...sheetRels.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1]));
      const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
      drawingRid = "rId" + nextId;
      sheetRels = sheetRels.replace(
        "</Relationships>",
        `<Relationship Id="${drawingRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingName}"/></Relationships>`
      );
    } else {
      drawingRid = "rId1";
      sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships ${RELS_NS}><Relationship Id="${drawingRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingName}"/></Relationships>`;
    }
    zip.file(sheetRelsPath, sheetRels);

    let sheetXml = await zip.file(sheetPath).async("string");
    const drawingTag = `<drawing r:id="${drawingRid}"/>`;
    if (sheetXml.includes("<extLst")) {
      sheetXml = sheetXml.replace("<extLst", drawingTag + "<extLst");
    } else {
      sheetXml = sheetXml.replace("</worksheet>", drawingTag + "</worksheet>");
    }
    zip.file(sheetPath, sheetXml);

    ctOverrides.push(
      `<Override PartName="/xl/drawings/${drawingName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    );
    ctOverrides.push(
      `<Override PartName="/xl/charts/${chartName}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
    );
  }

  ct = ct.replace("</Types>", ctOverrides.join("") + "</Types>");
  zip.file(ctPath, ct);

  return zip.generateAsync({ type: "nodebuffer" });
}
