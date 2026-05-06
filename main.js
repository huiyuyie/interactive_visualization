const stateDataPath = "data/us_state_cmip6_impact_categories.csv";
const countDataPath = "data/us_state_cmip6_category_counts.csv";
const usMapPath = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const width = 960;
const height = 560;

const svg = d3.select("#map")
  .attr("viewBox", [0, 0, width, height]);

const tooltip = d3.select("#tooltip");

const scenarioSelect = d3.select("#scenario-select");
const yearSlider = d3.select("#year-slider");
const yearLabel = d3.select("#year-label");

let selectedState = null;

const categoryClass = {
  "Low impact": "low",
  "Medium impact": "medium",
  "High impact": "high"
};

const stateIdToName = new Map([
  ["01", "Alabama"], ["02", "Alaska"], ["04", "Arizona"], ["05", "Arkansas"],
  ["06", "California"], ["08", "Colorado"], ["09", "Connecticut"], ["10", "Delaware"],
  ["12", "Florida"], ["13", "Georgia"], ["15", "Hawaii"], ["16", "Idaho"],
  ["17", "Illinois"], ["18", "Indiana"], ["19", "Iowa"], ["20", "Kansas"],
  ["21", "Kentucky"], ["22", "Louisiana"], ["23", "Maine"], ["24", "Maryland"],
  ["25", "Massachusetts"], ["26", "Michigan"], ["27", "Minnesota"], ["28", "Mississippi"],
  ["29", "Missouri"], ["30", "Montana"], ["31", "Nebraska"], ["32", "Nevada"],
  ["33", "New Hampshire"], ["34", "New Jersey"], ["35", "New Mexico"], ["36", "New York"],
  ["37", "North Carolina"], ["38", "North Dakota"], ["39", "Ohio"], ["40", "Oklahoma"],
  ["41", "Oregon"], ["42", "Pennsylvania"], ["44", "Rhode Island"], ["45", "South Carolina"],
  ["46", "South Dakota"], ["47", "Tennessee"], ["48", "Texas"], ["49", "Utah"],
  ["50", "Vermont"], ["51", "Virginia"], ["53", "Washington"], ["54", "West Virginia"],
  ["55", "Wisconsin"], ["56", "Wyoming"]
]);

Promise.all([
  d3.csv(stateDataPath, d3.autoType),
  d3.csv(countDataPath, d3.autoType),
  d3.json(usMapPath)
]).then(([stateData, countData, us]) => {
  const states = topojson.feature(us, us.objects.states).features;

  const projection = d3.geoAlbersUsa()
    .fitSize([width, height], { type: "FeatureCollection", features: states });

  const path = d3.geoPath(projection);

  function getCurrentData() {
    const scenario = scenarioSelect.property("value");
    const year = +yearSlider.property("value");

    return stateData.filter(d =>
      d.scenario === scenario &&
      d.year === year
    );
  }

  function update() {
    const scenario = scenarioSelect.property("value");
    const year = +yearSlider.property("value");

    yearLabel.text(year);

    const current = getCurrentData();
    const byState = new Map(current.map(d => [d.state, d]));

    svg.selectAll("path.state")
      .data(states, d => d.id)
      .join("path")
      .attr("class", d => {
        const stateName = stateIdToName.get(String(d.id).padStart(2, "0"));
        const row = byState.get(stateName);
        const cls = row ? categoryClass[row.impact_category] : "no-data";
        return `state ${cls} ${selectedState === stateName ? "selected" : ""}`;
      })
      .attr("d", path)
      .on("mousemove", (event, d) => {
        const stateName = stateIdToName.get(String(d.id).padStart(2, "0"));
        const row = byState.get(stateName);

        tooltip
          .style("opacity", 1)
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY + 12}px`)
          .html(row ? `
            <strong>${row.state}</strong><br>
            Scenario: ${row.scenario_label}<br>
            Year: ${row.year}<br>
            Category: ${row.impact_category}<br>
            Temp anomaly: ${row.temp_anomaly.toFixed(2)}°C
          ` : `
            <strong>${stateName}</strong><br>No data
          `);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
      })
      .on("click", (event, d) => {
        const stateName = stateIdToName.get(String(d.id).padStart(2, "0"));
        selectedState = selectedState === stateName ? null : stateName;
        update();
        updateStatePanel(byState.get(selectedState));
      });

    updateSummary(countData, scenario, year);
  }

  function updateStatePanel(row) {
    const panel = d3.select("#state-info");

    if (!row) {
      panel.html(`<p class="placeholder">Click a state to see details.</p>`);
      return;
    }

    const cls = categoryClass[row.impact_category];

    panel.html(`
      <h3>${row.state}</h3>
      <span class="badge ${cls}">${row.impact_category}</span>
      <p class="info-value">${row.temp_anomaly.toFixed(2)}°C</p>
      <p><strong>Scenario:</strong> ${row.scenario_label}</p>
      <p><strong>Year:</strong> ${row.year}</p>
      <p><strong>Impact score:</strong> ${row.impact_score}</p>
    `);
  }

  function updateSummary(countData, scenario, year) {
    const rows = countData.filter(d =>
      d.scenario === scenario &&
      d.year === year
    );

    const total = d3.sum(rows, d => d.state_count);

    const container = d3.select("#summary-bars");
    container.html("");

    const ordered = ["Low impact", "Medium impact", "High impact"];

    ordered.forEach(category => {
      const row = rows.find(d => d.impact_category === category);
      const count = row ? row.state_count : 0;
      const pct = total ? (count / total) * 100 : 0;
      const cls = categoryClass[category];

      const item = container.append("div")
        .attr("class", "summary-row");

      item.append("div")
        .attr("class", "summary-label")
        .html(`<span>${category}</span><span>${count} states</span>`);

      item.append("div")
        .attr("class", "summary-track")
        .append("div")
        .attr("class", `summary-fill ${cls}`)
        .style("width", `${pct}%`);
    });
  }

  scenarioSelect.on("change", update);
  yearSlider.on("input", update);

  update();
});