import fs from "node:fs/promises";

const DAY_MS = 86400000;
const REGION_ORDER = ["南方大区", "果次方", "华北大区", "东北大区"];
const VALID_REGION_SET = new Set(REGION_ORDER);
const JULY_TREE_KING_BOOTSTRAP = {
  northeastStart: "2026-07-01",
  fruitStart: "2026-07-07"
};

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const APP_TOKEN = process.env.FEISHU_APP_TOKEN;
const TABLE_ID = process.env.FEISHU_TABLE_ID;

if (!APP_ID || !APP_SECRET || !APP_TOKEN || !TABLE_ID) {
  throw new Error("Missing required Feishu secrets.");
}

const tenantAccessToken = await getTenantAccessToken();
const records = await getRecords(tenantAccessToken);
const previousBoardData = await loadPreviousBoardData();
const boardData = buildBoardData(records, previousBoardData);

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

async function loadPreviousBoardData() {
  try {
    const text = await fs.readFile(new URL("../board-data.json", import.meta.url), "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildBoardData(items, previousBoardData) {
  const now = new Date();
  const rows = items
    .map((item) => item.fields || {})
    .filter((fields) => fields.name)
    .map((fields) => ({
      name: String(fields.name).trim(),
      target: Number(fields.target) || 0,
      achieved: Number(fields.achieved) || 0
    }))
    .filter((row) => VALID_REGION_SET.has(row.name))
    .sort((left, right) => REGION_ORDER.indexOf(left.name) - REGION_ORDER.indexOf(right.name));

  const regions = rows.map(({ name, target, achieved }) => ({
    name,
    target,
    achieved
  }));

  const currentLeader = getLeaderName(rows);
  const treeHallState = buildTreeHallState(rows, currentLeader, previousBoardData, now);

  return {
    reportDate: formatShanghaiDate(now),
    updatedAt: formatShanghaiTimestamp(now),
    regions,
    treeHallEntries: treeHallState.entries,
    treeHallMeta: {
      currentLeader,
      lastSyncAt: now.toISOString()
    }
  };
}

function buildTreeHallState(rows, currentLeader, previousBoardData, now) {
  const statsMap = new Map();
  const previousEntries = Array.isArray(previousBoardData?.treeHallEntries) ? previousBoardData.treeHallEntries : [];
  const previousMeta = previousBoardData?.treeHallMeta || {};
  const previousLeader = typeof previousMeta.currentLeader === "string" && VALID_REGION_SET.has(previousMeta.currentLeader)
    ? previousMeta.currentLeader
    : "";
  const previousSyncAt = previousMeta.lastSyncAt ? new Date(previousMeta.lastSyncAt) : null;

  previousEntries.forEach((entry, index) => {
    if (!entry || typeof entry.name !== "string" || !VALID_REGION_SET.has(entry.name)) {
      return;
    }
    statsMap.set(entry.name, {
      name: entry.name,
      appearanceCount: Number.isFinite(Number(entry.appearanceCount)) ? Number(entry.appearanceCount) : 0,
      durationMs: Number.isFinite(Number(entry.durationMs)) ? Math.max(0, Number(entry.durationMs)) : 0,
      currentStreakMs: Number.isFinite(Number(entry.currentStreakMs)) ? Math.max(0, Number(entry.currentStreakMs)) : 0,
      crownedAt: Number.isFinite(Number(entry.crownedAt)) ? Number(entry.crownedAt) : now.getTime() + index,
      current: Boolean(entry.current)
    });
  });

  applyInitialPreset(statsMap);

  if (!hasMeaningfulHistory(previousEntries, previousLeader)) {
    bootstrapTreeHallState(statsMap, currentLeader, now);
    return { entries: finalizeTreeHallEntries(statsMap) };
  }

  rows.forEach((row, index) => {
    if (!statsMap.has(row.name)) {
      statsMap.set(row.name, {
        name: row.name,
        appearanceCount: 0,
        durationMs: 0,
        currentStreakMs: 0,
        crownedAt: now.getTime() + index + 100,
        current: false
      });
    }
  });
  const elapsedDays = previousSyncAt && !Number.isNaN(previousSyncAt.getTime())
    ? Math.max(0, diffShanghaiCalendarDays(previousSyncAt, now))
    : 0;
  const elapsedMs = elapsedDays * DAY_MS;

  if (previousLeader && statsMap.has(previousLeader)) {
    const previousLeaderStats = statsMap.get(previousLeader);
    previousLeaderStats.durationMs += elapsedMs;
    if (previousLeader === currentLeader) {
      previousLeaderStats.currentStreakMs += elapsedMs;
    } else {
      previousLeaderStats.currentStreakMs = 0;
      previousLeaderStats.current = false;
    }
  }

  statsMap.forEach((entry) => {
    if (entry.name !== currentLeader) {
      entry.current = false;
      if (entry.name !== previousLeader) {
        entry.currentStreakMs = 0;
      }
    }
  });

  if (currentLeader && statsMap.has(currentLeader)) {
    const currentLeaderStats = statsMap.get(currentLeader);
    if (previousLeader !== currentLeader) {
      currentLeaderStats.appearanceCount += 1;
      currentLeaderStats.durationMs += DAY_MS;
      currentLeaderStats.currentStreakMs = DAY_MS;
      currentLeaderStats.crownedAt = now.getTime();
    } else if (currentLeaderStats.appearanceCount <= 0) {
      currentLeaderStats.appearanceCount = 1;
      currentLeaderStats.durationMs = Math.max(currentLeaderStats.durationMs, DAY_MS);
      currentLeaderStats.currentStreakMs = Math.max(currentLeaderStats.currentStreakMs, DAY_MS);
    }
    currentLeaderStats.current = true;
  }

  return { entries: finalizeTreeHallEntries(statsMap) };
}

function applyInitialPreset(statsMap) {
  const fruit = statsMap.get("果次方");
  if (fruit) {
    fruit.appearanceCount = Math.max(fruit.appearanceCount, 1);
    fruit.crownedAt = Math.min(fruit.crownedAt, new Date(2026, 6, 7).getTime());
  } else {
    statsMap.set("果次方", {
      name: "果次方",
      appearanceCount: 1,
      durationMs: 0,
      currentStreakMs: 0,
      crownedAt: new Date(2026, 6, 7).getTime(),
      current: false
    });
  }

  const northeast = statsMap.get("东北大区");
  if (northeast) {
    northeast.appearanceCount = Math.max(northeast.appearanceCount, 1);
    northeast.durationMs = Math.max(northeast.durationMs, 6 * DAY_MS);
    northeast.crownedAt = Math.min(northeast.crownedAt, new Date(2026, 6, 1).getTime());
    return;
  }

  statsMap.set("东北大区", {
    name: "东北大区",
    appearanceCount: 1,
    durationMs: 6 * DAY_MS,
    currentStreakMs: 0,
    crownedAt: new Date(2026, 6, 1).getTime(),
    current: false
  });
}

function hasMeaningfulHistory(previousEntries, previousLeader) {
  return previousEntries.some((entry) => entry && typeof entry.name === "string" && VALID_REGION_SET.has(entry.name))
    || Boolean(previousLeader);
}

function bootstrapTreeHallState(statsMap, currentLeader, now) {
  const today = formatShanghaiDate(now);
  const northeast = statsMap.get("东北大区");
  const fruit = statsMap.get("果次方");

  if (northeast) {
    northeast.appearanceCount = Math.max(northeast.appearanceCount, 1);
    northeast.current = false;
  }

  if (fruit) {
    fruit.appearanceCount = Math.max(fruit.appearanceCount, 1);
    fruit.current = false;
  }

  if (currentLeader === "果次方" && today >= JULY_TREE_KING_BOOTSTRAP.fruitStart && fruit) {
    const fruitDays = Math.max(1, diffShanghaiCalendarDays(
      new Date(`${JULY_TREE_KING_BOOTSTRAP.fruitStart}T00:00:00+08:00`),
      now
    ) + 1);
    fruit.durationMs = Math.max(fruit.durationMs, fruitDays * DAY_MS);
    fruit.currentStreakMs = fruitDays * DAY_MS;
    fruit.current = true;
    return;
  }

  if (currentLeader === "东北大区" && today < JULY_TREE_KING_BOOTSTRAP.fruitStart && northeast) {
    const northeastDays = Math.max(1, diffShanghaiCalendarDays(
      new Date(`${JULY_TREE_KING_BOOTSTRAP.northeastStart}T00:00:00+08:00`),
      now
    ) + 1);
    northeast.durationMs = Math.max(northeast.durationMs, northeastDays * DAY_MS);
    northeast.currentStreakMs = northeastDays * DAY_MS;
    northeast.current = true;
  }
}

function finalizeTreeHallEntries(statsMap) {
  return [...statsMap.values()]
    .filter((entry) => VALID_REGION_SET.has(entry.name))
    .filter((entry) => entry.appearanceCount > 0 || entry.durationMs > 0 || entry.current)
    .sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }
      if (right.appearanceCount !== left.appearanceCount) {
        return right.appearanceCount - left.appearanceCount;
      }
      if (right.durationMs !== left.durationMs) {
        return right.durationMs - left.durationMs;
      }
      return left.crownedAt - right.crownedAt;
    })
    .map((entry) => {
      const base = {
        name: entry.name,
        appearanceCount: Math.max(0, entry.appearanceCount || 0),
        durationMs: Math.max(0, entry.durationMs || 0),
        crownedAt: entry.crownedAt,
        current: Boolean(entry.current)
      };
      if (base.current) {
        return {
          ...base,
          currentStreakMs: Math.max(0, entry.currentStreakMs || 0)
        };
      }
      return base;
    });
}

function diffShanghaiCalendarDays(left, right) {
  const leftKey = formatShanghaiDate(left);
  const rightKey = formatShanghaiDate(right);
  const [leftYear, leftMonth, leftDay] = leftKey.split("-").map(Number);
  const [rightYear, rightMonth, rightDay] = rightKey.split("-").map(Number);
  const leftUtc = Date.UTC(leftYear, leftMonth - 1, leftDay);
  const rightUtc = Date.UTC(rightYear, rightMonth - 1, rightDay);
  return Math.floor((rightUtc - leftUtc) / DAY_MS);
}

function getLeaderName(rows) {
  const sorted = [...rows].sort((left, right) => {
    if (right.achieved !== left.achieved) {
      return right.achieved - left.achieved;
    }
    return (right.target ? right.achieved / right.target : 0) - (left.target ? left.achieved / left.target : 0);
  });
  return sorted[0]?.name || "";
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
