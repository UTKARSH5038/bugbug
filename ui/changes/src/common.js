import ApexCharts from "apexcharts";
import { Temporal } from "proposal-temporal/lib/index.mjs";
import localForage from "localforage";

// let METABUGS_URL =
//   "https://bugzilla.mozilla.org/rest/bug?include_fields=id,summary,status&keywords=feature-testing-meta%2C%20&keywords_type=allwords";
let LANDINGS_URL =
  "https://community-tc.services.mozilla.com/api/index/v1/task/project.bugbug.landings_risk_report.latest/artifacts/public/landings_by_date.json";
let COMPONENT_CONNECTIONS_URL =
  "https://community-tc.services.mozilla.com/api/index/v1/task/project.bugbug.landings_risk_report.latest/artifacts/public/component_connections.json";

function getCSSVariableValue(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

const EXPIRE_CACHE = (() => {
  localForage.config({
    driver: localForage.INDEXEDDB,
  });
  return {
    get: async (key) => {
      let data;
      try {
        data = await localForage.getItem(key);
      } catch (e) {}

      if (!data) return data;

      const { expire, value } = data;

      if (expire < Date.now()) {
        localForage.removeItem(key);
        return null;
      }

      return value;
    },
    set: (key, value, expire = false, callback = false) => {
      if (expire && typeof expire === "number")
        expire = Math.round(expire * 1000 + Date.now()); // * 1000 to use seconds

      return localForage.setItem(key, { value, expire }, expire && callback);
    },
  };
})();

export let getPlainDate = (() => {
  let cache = new Map();

  return (date) => {
    let plainDate = cache.get(date);
    if (!plainDate) {
      plainDate = Temporal.PlainDate.from(date);
      cache.set(date, plainDate);
    }

    return plainDate;
  };
})();

export const TESTING_TAGS = {
  "testing-approved": {
    color: getCSSVariableValue("--green-60"),
    label: "approved",
  },
  "testing-exception-unchanged": {
    color: getCSSVariableValue("--teal-60"),
    label: "unchanged",
  },
  "testing-exception-elsewhere": {
    color: getCSSVariableValue("--blue-50"),
    label: "elsewhere",
  },
  "testing-exception-ui": {
    color: getCSSVariableValue("--purple-50"),
    label: "ui",
  },
  "testing-exception-other": {
    color: getCSSVariableValue("--yellow-50"),
    label: "other",
  },
  missing: {
    color: getCSSVariableValue("--red-60"),
    label: "missing",
  },
  unknown: {
    color: getCSSVariableValue("--grey-30"),
    label: "unknown",
  },
};

let taskclusterLandingsArtifact = (async function () {
  let json = await EXPIRE_CACHE.get("taskclusterLandingsArtifact");
  if (!json) {
    let response = await fetch(LANDINGS_URL);
    json = await response.json();
    // 30 minutes
    EXPIRE_CACHE.set("taskclusterLandingsArtifact", json, 60 * 30);
  } else {
    console.log("taskclusterLandingsArtifact cache hit", json);
  }

  return json;
})();

let taskclusterComponentConnectionsArtifact = (async function () {
  let json = await EXPIRE_CACHE.get("taskclusterComponentConnectionsArtifact");
  if (!json) {
    let response = await fetch(COMPONENT_CONNECTIONS_URL);
    json = await response.json();
    // 30 minutes
    EXPIRE_CACHE.set("taskclusterComponentConnectionsArtifact", json, 60 * 30);
  } else {
    console.log("taskclusterComponentConnectionsArtifact cache hit", json);
  }

  return json;
})();

export let componentConnections = (async function () {
  let json = await taskclusterComponentConnectionsArtifact;
  return json;
})();

export let featureMetabugs = (async function () {
  let json = await taskclusterLandingsArtifact;
  return json.featureMetaBugs;
})();

export async function getFirefoxReleases() {
  let response = await fetch(
    "https://product-details.mozilla.org/1.0/firefox_history_major_releases.json"
  );
  return await response.json();
}

export let landingsData = (async function () {
  let json = await taskclusterLandingsArtifact;
  json = json.summaries;

  // Sort the dates so object iteration will be sequential:
  let orderedDates = [];
  for (let date in json) {
    orderedDates.push(date);
  }
  orderedDates.sort((a, b) => {
    return Temporal.PlainDate.compare(getPlainDate(a), getPlainDate(b));
  });

  let returnedObject = {};
  for (let date of orderedDates) {
    returnedObject[date] = json[date];
  }

  document.body.classList.remove("loading-data");

  return returnedObject;
})();

export class Counter {
  constructor() {
    return new Proxy(
      {},
      {
        get: (target, name) => (name in target ? target[name] : 0),
      }
    );
  }
}

export async function getSummaryData(
  bugSummaries,
  grouping = "daily",
  startDate,
  counter,
  filter,
  dateGetter = (summary) => summary.date
) {
  let dates = [...new Set(bugSummaries.map((summary) => dateGetter(summary)))];
  dates.sort((a, b) =>
    Temporal.PlainDate.compare(getPlainDate(a), getPlainDate(b))
  );

  let dailyData = {};
  for (let date of dates) {
    if (Temporal.PlainDate.compare(getPlainDate(date), startDate) < 1) {
      continue;
    }

    dailyData[date] = new Counter();
  }

  for (let summary of bugSummaries) {
    let counterObj = dailyData[dateGetter(summary)];
    if (!counterObj) {
      continue;
    }

    if (filter && !filter(summary)) {
      continue;
    }

    counter(counterObj, summary);
  }

  let labels = new Set(
    Object.values(dailyData).flatMap((data) => Object.keys(data))
  );

  if (grouping == "weekly") {
    let weeklyData = {};
    for (let daily in dailyData) {
      let date = getPlainDate(daily);
      let weekStart = date.subtract({ days: date.dayOfWeek }).toString();

      if (!weeklyData[weekStart]) {
        weeklyData[weekStart] = new Counter();
      }

      for (let label of labels) {
        weeklyData[weekStart][label] += dailyData[daily][label];
      }
    }

    return weeklyData;
  } else if (grouping == "monthly") {
    let monthlyData = {};
    for (let daily in dailyData) {
      let date = getPlainDate(daily);
      let yearMonth = Temporal.PlainYearMonth.from(date);

      if (!monthlyData[yearMonth]) {
        monthlyData[yearMonth] = new Counter();
      }

      for (let label of labels) {
        monthlyData[yearMonth][label] += dailyData[daily][label];
      }
    }
    return monthlyData;
  } else if (grouping == "by_release") {
    let byReleaseData = {};
    let releases = await getFirefoxReleases();
    for (const daily in dailyData) {
      let version = null;
      for (const [cur_version, cur_date] of Object.entries(releases)) {
        if (
          Temporal.PlainDate.compare(
            getPlainDate(daily),
            getPlainDate(cur_date)
          ) < 1
        ) {
          break;
        }
        version = cur_version;
      }

      if (!byReleaseData[version]) {
        byReleaseData[version] = new Counter();
      }

      for (let label of labels) {
        byReleaseData[version][label] += dailyData[daily][label];
      }
    }
    return byReleaseData;
  }

  return dailyData;
}

export async function getTestingPolicySummaryData(grouping = "daily", filter) {
  let bugSummaries = [].concat
    .apply([], Object.values(await landingsData))
    .filter((summary) => summary.date);

  return getSummaryData(
    bugSummaries,
    grouping,
    getPlainDate("2020-09-01"), // Ignore data before the testing policy took place.
    (counterObj, bug) => {
      for (let commit of bug.commits) {
        if (!commit.testing) {
          counterObj.unknown++;
        } else {
          counterObj[commit.testing] += 1;
        }
      }
    },
    filter
  );
}

export function renderChart(chartEl, series, dates, title, yaxis_text) {
  let options = {
    series: series,
    chart: {
      height: 350,
      type: "line",
      dropShadow: {
        enabled: true,
        color: "#000",
        top: 18,
        left: 7,
        blur: 10,
        opacity: 0.2,
      },
      toolbar: {
        show: false,
      },
    },
    dataLabels: {
      enabled: true,
    },
    stroke: {
      curve: "smooth",
    },
    title: {
      text: title,
      align: "left",
    },
    grid: {
      borderColor: "#e7e7e7",
      row: {
        colors: ["#f3f3f3", "transparent"],
        opacity: 0.5,
      },
    },
    markers: {
      size: 1,
    },
    xaxis: {
      categories: dates,
      title: {
        text: "Date",
      },
    },
    yaxis: {
      title: {
        text: yaxis_text,
      },
    },
    legend: {
      position: "top",
      horizontalAlign: "right",
      floating: true,
      offsetY: -25,
      offsetX: -5,
    },
  };

  let chart = new ApexCharts(chartEl, options);
  chart.render();
}

export function summarizeCoverage(bugSummary) {
  let lines_added = 0;
  let lines_covered = 0;
  let lines_unknown = 0;
  for (let commit of bugSummary.commits) {
    if (commit["coverage"]) {
      lines_added += commit["coverage"][0];
      lines_covered += commit["coverage"][1];
      lines_unknown += commit["coverage"][2];
    }
  }

  return [lines_added, lines_covered, lines_unknown];
}

export async function getComponentRegressionMap(threshold = 0.05) {
  let connections = await componentConnections;

  // // Return an object with each component and the components that are most likely
  // // to cause regressions to that component.
  let connectionsMap = {};
  for (let c of connections) {
    for (let regression_component in c.most_common_regression_components) {
      // Ignore < N%
      if (
        c.most_common_regression_components[regression_component] < threshold
      ) {
        continue;
      }
      if (!connectionsMap[regression_component]) {
        connectionsMap[regression_component] = {};
      }
      connectionsMap[regression_component][c.component] =
        c.most_common_regression_components[regression_component];
    }
  }

  return connectionsMap;
}
