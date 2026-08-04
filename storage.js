/* Data layer: Airtable-backed store shared across every device that has a
   Personal Access Token for the MCG Safety Ethos — Field Inspections base
   (see config.js for the base ID). Uses the Airtable REST API directly via
   fetch — no client library, no backend. */

let airtableToken = null;

function initAirtableClient() {
  airtableToken = getAirtableToken();
  return !!airtableToken;
}

/* ---------------- low-level Airtable REST helpers ---------------- */

async function atRequest(path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${airtableToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let message = `Airtable error ${res.status}`;
    try { const body = await res.json(); message = (body.error && (body.error.message || body.error.type)) || message; } catch (e) { /* ignore */ }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function atListAll(tableName, params = {}) {
  const records = [];
  let offset;
  do {
    const qs = new URLSearchParams(params);
    qs.set("pageSize", "100");
    if (offset) qs.set("offset", offset);
    else qs.delete("offset");
    const data = await atRequest(`/${encodeURIComponent(tableName)}?${qs.toString()}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

function atCreate(tableName, fields) {
  return atRequest(`/${encodeURIComponent(tableName)}`, { method: "POST", body: JSON.stringify({ fields, typecast: true }) });
}

/* ---------------- lookup lists (Sites / Areas / Inspectors) ---------------- */

function fetchLookupList(tableName) {
  return atListAll(tableName).then(function (records) {
    return records
      .map(function (r) { return { id: r.id, name: r.fields.Name || "" }; })
      .filter(function (i) { return i.name; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  });
}

function addLookupItem(tableName, name) {
  return atCreate(tableName, { Name: name }).then(function (rec) {
    return { id: rec.id, name: name };
  });
}

/* ---------------- app record <-> Airtable field mapping ---------------- */

var SYNC_CATEGORY_LABELS = {
  ppe: "PPE",
  workingConditions: "Working Conditions",
  bodyPositioning: "Body Positioning",
  tools: "Tools",
  environmental: "Environmental",
};

function categoryDetailsText(awareness, action) {
  var parts = [];
  var notes = (awareness.notes || []).filter(function (n) { return n && n.trim(); });
  if (notes.length) {
    parts.push("Observations:\n" + notes.map(function (n, i) { return (i + 1) + ". " + n; }).join("\n"));
  }
  if (action.qualified === "yes") parts.push("Actioned directly by inspector.");
  if (action.qualified === "no") parts.push("Assigned to: " + (action.accountable || "unnamed"));
  var actions = (action.correctiveActions || []).filter(function (a) { return a && a.trim(); });
  if (actions.length) {
    parts.push(actions.length > 1
      ? "Corrective actions:\n" + actions.map(function (a, i) { return (i + 1) + ". " + a; }).join("\n")
      : "Corrective action: " + actions[0]);
  }
  return parts.join("\n");
}

function buildAirtableFields(state, categories) {
  var fields = {
    "Site Location": state.site || "",
    "Date": state.date || null,
    "Area Inspected": state.area || "",
    "Inspector": state.inspector || "",
    "Accompanied By": state.accompanied || "",
  };

  var categoriesFlagged = 0, atRiskTotal = 0;
  categories.forEach(function (c) {
    var label = SYNC_CATEGORY_LABELS[c.id];
    var aw = state.awareness[c.id];
    var ac = state.action[c.id];
    var flagged = aw.status === "no";
    if (flagged) { categoriesFlagged++; atRiskTotal += (aw.tally || 0); }
    fields[label + " Status"] = aw.status === null ? "Not Recorded" : flagged ? "At Risk" : "Clear";
    fields[label + " At-Risk Count"] = aw.tally || 0;
    fields[label + " Details"] = categoryDetailsText(aw, ac);
  });
  fields["Categories Flagged"] = categoriesFlagged;
  fields["At-Risk Observations"] = atRiskTotal;

  var loggedObs = state.observations.filter(function (o) { return o.behavior || o.swa; });
  fields["Stop Work Log"] = loggedObs.map(function (o) {
    return "- " + (o.behavior || "(no description)") + " | SWA used: " + (o.swa || "pending") +
      (o.correctiveAction ? " | Action: " + o.correctiveAction : "") + (o.time ? " | Completed: " + o.time : "");
  }).join("\n");
  fields["SWA Used Count"] = loggedObs.filter(function (o) { return o.swa === "yes"; }).length;
  fields["Observations Logged"] = loggedObs.length;
  fields["Additional Notes"] = state.notes || "";

  return fields;
}

function fromAirtableRecord(rec, categories) {
  var f = rec.fields;
  var categoryFlags = {};
  var categoryDetails = {};
  var categoryCounts = {};
  categories.forEach(function (c) {
    var label = SYNC_CATEGORY_LABELS[c.id];
    categoryFlags[c.id] = f[label + " Status"] === "At Risk";
    categoryDetails[c.id] = f[label + " Details"] || "";
    categoryCounts[c.id] = f[label + " At-Risk Count"] || 0;
  });
  return {
    id: rec.id,
    submittedAt: rec.createdTime,
    site: f["Site Location"] || "",
    date: f["Date"] || "",
    area: f["Area Inspected"] || "",
    inspector: f["Inspector"] || "",
    accompanied: f["Accompanied By"] || "",
    categoryFlags: categoryFlags,
    categoryDetails: categoryDetails,
    categoryCounts: categoryCounts,
    categoriesFlagged: f["Categories Flagged"] || 0,
    atRiskTotal: f["At-Risk Observations"] || 0,
    observationsTotal: f["Observations Logged"] || 0,
    swaUsedCount: f["SWA Used Count"] || 0,
    stopWorkLog: f["Stop Work Log"] || "",
    notes: f["Additional Notes"] || "",
  };
}
