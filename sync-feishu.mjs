import fs from "node:fs/promises";

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const APP_TOKEN = process.env.FEISHU_APP_TOKEN;
const TABLE_ID = process.env.FEISHU_TABLE_ID;

if (!APP_ID || !APP_SECRET || !APP_TOKEN || !TABLE_ID) {
  throw new Error("Missing required Feishu secrets.");
}

const tenantAccessToken = await getTenantAccessToken();
const records = await getRecords(tenantAccessToken);
const boardData = buildBoardData(records);

await fs.writeFile(
  new URL("../board-data.json", import.meta.url),
  `${JSON.stringify(boardData, null, 2)}\n`,
  "utf8"
);

async function getTenantAccessToken() {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      app_id: APP_ID,
      app_secret: APP_SECRET
    })
  });

  const result = await response.json();
  if (!response.ok || !result.tenant_access_token) {
    throw new Error(`tenant_access_token_failed: ${JSON.stringify(result)}`);
  }

  return result.tenant_access_token;
}

async function getRecords(tenantAccessToken) {
  const response = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records?page_size=100`,
    {
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`
      }
    }
  );

  const result = await response.json();
  if (!response.ok || !Array.isArray(result?.data?.items)) {
    throw new Error(`bitable_records_failed: ${JSON.stringify(result)}`);
  }

  return result.data.items;
}

function buildBoardData(items) {
  const regionOrder = ["南方大区", "果次方", "华北大区", "东北大区"];
  const regions = items
    .map((item) => item.fields || {})
    .filter((fields) => fields.name)
    .map((fields) => ({
      name: String(fields.name).trim(),
      target: Number(fields.target) || 0,
      achieved: Number(fields.achieved) || 0
    }))
    .sort((left, right) => regionOrder.indexOf(left.name) - regionOrder.indexOf(right.name));

  return {
    reportDate: formatShanghaiDate(new Date()),
    updatedAt: formatShanghaiTimestamp(new Date()),
    regions
  };
}

function formatShanghaiDate(date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function formatShanghaiTimestamp(date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}
