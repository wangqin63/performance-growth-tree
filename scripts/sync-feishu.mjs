      lastSyncAt: now.toISOString()
    }
  };
}

function buildTreeHallState(rows, currentLeader, previousBoardData, now) {
  const statsMap = new Map();
  const previousEntries = Array.isArray(previousBoardData?.treeHallEntries) ? previousBoardData.treeHallEntries : [];
  const previousMeta = previousBoardData?.treeHallMeta || {};

  previousEntries.forEach((entry, index) => {
    if (!entry || typeof entry.name !== "string" || !entry.name) {
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

  const previousLeader = typeof previousMeta.currentLeader === "string" ? previousMeta.currentLeader : "";
  const previousSyncAt = previousMeta.lastSyncAt ? new Date(previousMeta.lastSyncAt) : null;
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

  const entries = [...statsMap.values()]
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
    });

  return { entries };
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
