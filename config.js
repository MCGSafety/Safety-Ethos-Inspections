/* Per-device connection settings — the Airtable base this browser talks to.
   The base itself (MCG Safety Ethos — Field Inspections) already exists and is
   shared by everyone; each device just needs a Personal Access Token to reach it. */

const AIRTABLE_BASE_ID = "appQbNmfsZIbqziKp";
const AIRTABLE_TABLE_NAME = "Inspections";

const TOKEN_KEY = "safety_ethos_airtable_token_v1";

function getAirtableToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

function setAirtableToken(token) {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

function clearAirtableToken() {
  localStorage.removeItem(TOKEN_KEY);
}
