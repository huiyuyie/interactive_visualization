const DATA_DIR = './data/';
const FILES = {
  statesGeo: `${DATA_DIR}us_states.geojson`,
  countiesGeo: `${DATA_DIR}us_counties.geojson`,
  stateCsv: `${DATA_DIR}state_warming_observed2025_cmip6_2026_2036.csv`,
  countyCsv: `${DATA_DIR}county_warming_observed2025_cmip6_2026_2036.csv`,
};

const CONUS_EXCLUDE = new Set([
  'Alaska', 'Hawaii', 'Puerto Rico', 'Guam', 'American Samoa',
  'Commonwealth of the Northern Mariana Islands', 'United States Virgin Islands'
]);

const scenarioLabels = {
  ssp126: 'SSP126 · lower emissions',
  ssp245: 'SSP245 · middle pathway',
  ssp585: 'SSP585 · higher emissions',
};

const scenarioShort = {
  ssp126: 'Lower',
  ssp245: 'Middle',
  ssp585: 'Higher',
};

const storyTargets = {
  ssp126: { increase: 'North Dakota', decrease: 'Tennessee' },
  ssp245: { increase: 'North Dakota', decrease: 'Tennessee' },
  ssp585: { increase: 'Oklahoma', decrease: 'Washington' },
};

const svg = d3.select('#map');
const tooltip = d3.select('#tooltip');
const yearSlider = d3.select('#year-slider');
const yearLabel = d3.select('#year-label');
const scenarioSelect = d3.select('#scenario-select');
const resetButton = d3.select('#reset-button');
const continueButton = d3.select('#continue-button');
const storyTitle = d3.select('#story-title');
const storyText = d3.select('#story-text');
const stepLabel = d3.select('#step-label');
const scenarioChoice = d3.select('#story-scenario-choice');
const controlsPanel = d3.select('.controls');
const mapCard = d3.select('.map-card');

let width = 960;
let height = 640;
let currentScenario = 'ssp585';
let currentYear = 2035;
let selectedState = null;
let storyStep = 0;
let userPickedScenario = false;
let animationTimer = null;
let tooltipAnchor = null;

const projection = d3.geoAlbersUsa();
const path = d3.geoPath(projection);

const g = svg.append('g');
const statesLayer = g.append('g').attr('class', 'states-layer');
const countiesLayer = g.append('g').attr('class', 'counties-layer');
const outlineLayer = g.append('g').attr('class', 'outline-layer');

let statesGeo, countiesGeo, stateRows, countyRows;
let stateByKey = new Map();
let countyByKey = new Map();
let stateFeatureByName = new Map();

const fmtTemp = d => Number.isFinite(d) ? `${d.toFixed(1)}°C` : '—';
const fmtChange = d => Number.isFinite(d) ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}°C` : '—';

let colorScale = d3.scaleDiverging([-1, 0, 1], t => d3.interpolateRdBu(1 - t));
let currentColorLimit = 1;
let globalStateColorLimit = 1;
let globalCountyColorLimit = 1;

Promise.all([
  d3.json(FILES.statesGeo),
  d3.json(FILES.countiesGeo),
  d3.csv(FILES.stateCsv, d3.autoType),
  d3.csv(FILES.countyCsv, d3.autoType),
]).then(([states, counties, sRows, cRows]) => {
  statesGeo = {
    ...states,
    features: states.features.filter(d => !CONUS_EXCLUDE.has(getStateName(d)))
  };
  countiesGeo = {
    ...counties,
    features: counties.features.filter(d => !CONUS_EXCLUDE.has(getCountyStateName(d)))
  };

  stateRows = normalizeRows(sRows, 'state').filter(d => !CONUS_EXCLUDE.has(d.state));
  countyRows = normalizeRows(cRows, 'county').filter(d => !CONUS_EXCLUDE.has(d.state));

  setupData();
  setupMap();
  updateMap();
  updateLegend();
  setControlsEnabled(false);
  updateStoryStep(0);
}).catch(error => {
  console.error(error);
  d3.select('#map-caption').text('Could not load data files. Check that the CSV and GeoJSON files are inside the data/ folder and match the expected filenames.');
});

function normalizeRows(rows, level) {
  return rows.map(row => {
    const d = { ...row };
    d.year = +row.year;
    d.scenario = String(row.scenario || '').trim();
    d.observed_temp_2025_c = getNumber(row, ['observed_temp_2025_c', 'observed_temp_c', 'observed_2025_c', 'temp_2025_c']);
    d.projected_temp_c = getNumber(row, ['adjusted_projected_temp_c', 'projected_temp_c', 'projected_temp', 'temp_c']);
    d.temp_change_from_2025_c = getNumber(row, ['temp_change_from_2025_c', 'cmip6_delta_from_2025_c', 'projected_change_from_2025_c', 'warming_since_2025_c']);

    if (!Number.isFinite(d.temp_change_from_2025_c) && Number.isFinite(d.projected_temp_c) && Number.isFinite(d.observed_temp_2025_c)) {
      d.temp_change_from_2025_c = d.projected_temp_c - d.observed_temp_2025_c;
    }

    if (level === 'county') {
      d.county_fips = String(row.county_fips || row.GEOID || row.geoid || '').padStart(5, '0');
      d.county = row.county || row.NAME || row.name || 'Unknown county';
      d.state = row.state || row.state_name || row.STATE_NAME || '';
      d.state_abbr = row.state_abbr || row.STUSPS || '';
    } else {
      d.state = row.state || row.state_name || row.NAME || row.name || '';
      d.state_abbr = row.state_abbr || row.STUSPS || '';
    }
    return d;
  });
}

function getNumber(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      const value = +row[key];
      if (Number.isFinite(value)) return value;
    }
  }
  return NaN;
}

function setupData() {
  stateByKey = d3.rollup(stateRows, v => v[0], d => stateKey(d.state, d.year, d.scenario));
  countyByKey = d3.rollup(countyRows, v => v[0], d => countyKey(d.county_fips, d.year, d.scenario));
  stateFeatureByName = new Map(statesGeo.features.map(f => [normalizeStateName(getStateName(f)), f]));

  globalStateColorLimit = getGlobalColorLimit(stateRows);
  globalCountyColorLimit = getGlobalColorLimit(countyRows);
}

function getGlobalColorLimit(rows) {
  const values = rows
    .map(d => d.temp_change_from_2025_c)
    .filter(Number.isFinite)
    .map(Math.abs)
    .sort(d3.ascending);

  return Math.max(0.15, d3.quantile(values, 0.95) || d3.max(values) || 1);
}

function setupMap() {
  resizeSvg();

  svg.on('click', (event) => {
    if (event.target === svg.node() && selectedState) {
      resetZoom();
    }
  });

  window.addEventListener('resize', () => {
    resizeSvg();
    updateMap();
  });

  window.addEventListener('scroll', () => {
    hideTooltip();
  });

  statesLayer.selectAll('path')
    .data(statesGeo.features)
    .join('path')
    .attr('class', 'state')
    .attr('d', path)
    .on('mouseenter', function(event, d) {
      d3.select(this).raise();
      handleStateMouseEnter(event, d);
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip)
    .on('click', (event, d) => {
      const stateName = getStateName(d);
      if (selectedState === stateName) {
        resetZoom();
      } else {
        zoomToState(d, { updateStory: false });
      }
    });

countiesLayer.selectAll('path')
  .data(countiesGeo.features)
  .join('path')
  .attr('class', 'county hidden-county')
  .attr('d', path)
  .on('mouseenter', function(event, d) {
    d3.select(this).raise();
    handleCountyMouseEnter(event, d);
  })
  .on('mousemove', moveTooltip)
  .on('mouseleave', hideTooltip)
  .on('click', (event) => {
    event.stopPropagation();
  });

  scenarioSelect.on('change', event => {
    currentScenario = event.target.value;
    setScenarioChoiceActive(currentScenario);
    updateMap();
    updateLegend();
  });

  yearSlider.on('input', event => {
    currentYear = +event.target.value;
    yearLabel.text(currentYear);
    updateMap();
    updateLegend();
  });

  resetButton.on('click', () => resetZoom());

  continueButton.on('click', () => {
    if (storyStep > 6) {
      restartStory();
      return;
    }

    if (storyStep === 2 && !userPickedScenario) return;

    updateStoryStep(storyStep + 1);
  });

  scenarioChoice.selectAll('button').on('click', event => {
    const scenario = event.currentTarget.dataset.scenario;
    userPickedScenario = true;
    currentScenario = scenario;
    scenarioSelect.property('value', scenario);
    setScenarioChoiceActive(scenario);

    controlsPanel.classed('hidden', false);
    mapCard.classed('hidden', false);

    updateMap();
    updateLegend();

    continueButton
      .text('Continue')
      .property('disabled', false);
  });
}

function resizeSvg() {
  const rect = svg.node().getBoundingClientRect();
  width = rect.width || 960;
  height = rect.height || 640;
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  projection.fitSize([width, height], statesGeo);
  path.projection(projection);
  statesLayer.selectAll('path').attr('d', path);
  countiesLayer.selectAll('path').attr('d', path);
  outlineLayer.selectAll('path').attr('d', path);
}

function setControlsEnabled(enabled) {
  scenarioSelect.property('disabled', !enabled);
  yearSlider.property('disabled', !enabled);
}

function setScenarioChoiceActive(scenario) {
  scenarioChoice.selectAll('button').classed('active', function () {
    return this.dataset.scenario === scenario;
  });
}

function scrollToMap() {
  hideTooltip();

  const map = document.querySelector('#map');
  if (!map) return;

  const mapRect = map.getBoundingClientRect();

  const y =
    mapRect.top +
    window.scrollY +
    mapRect.height / 2 -
    window.innerHeight / 2;

  window.scrollTo({
    top: y,
    behavior: 'smooth'
  });
}

function scrollToStory() {
  hideTooltip();

  const storyCard = document.querySelector('.story-card');
  if (!storyCard) return;

  const y = storyCard.getBoundingClientRect().top + window.scrollY - 20;

  window.scrollTo({
    top: y,
    behavior: 'smooth'
  });
}

function restartStory() {
  stopYearLoop();

  currentScenario = 'ssp585';
  currentYear = 2026;
  selectedState = null;
  userPickedScenario = false;

  scenarioSelect.property('value', currentScenario);
  yearSlider.property('value', currentYear);
  yearLabel.text(currentYear);

  scenarioChoice.selectAll('button').classed('active', false);

  setControlsEnabled(false);
  resetZoom({ quiet: true });
  setYear(2026);
  updateStoryStep(0);

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

function updateStoryStep(nextStep) {
  stopYearLoop();
  storyStep = nextStep;
  clearHighlights();

  if (storyStep === 0) {
    controlsPanel.classed('hidden', true);
    mapCard.classed('hidden', true);

    setControlsEnabled(false);
    scenarioChoice.classed('hidden', true);
    continueButton.text('Continue').property('disabled', false);
    stepLabel.text('Step 1');
    storyTitle.text('2025 just passed...');
    storyText.text('2025 gives us a real starting point. What does temperature look like now, and how might it change over the next decade?');
    setYear(2026);
    resetZoom({ quiet: true });
  } else if (storyStep === 1) {
    controlsPanel.classed('hidden', true);
    mapCard.classed('hidden', true);

    stepLabel.text('Step 2');
    storyTitle.text('We start from a real baseline.');
    storyText.text('The map uses observed 2025 county temperature as the local starting point, then applies CMIP6 projected change from that baseline.');
    setYear(2026);
    resetZoom({ quiet: true });
  } else if (storyStep === 2) {
  controlsPanel.classed('hidden', true);
  mapCard.classed('hidden', true);

  stepLabel.text('Step 3');
  storyTitle.text('Choose a future emissions pathway');
  storyText.text('Pick a scenario to see how warming patterns may unfold across U.S. states.');
  scenarioChoice.classed('hidden', false);

  controlsPanel.classed('hidden', true);
  mapCard.classed('hidden', true);

  userPickedScenario = false;

  // Clear default active pathway
  scenarioChoice.selectAll('button').classed('active', false);

  continueButton
    .text('Choose a pathway')
    .property('disabled', true);
  } else if (storyStep === 3) {
  controlsPanel.classed('hidden', false);
  mapCard.classed('hidden', false);
  scenarioChoice.classed('hidden', true);
  stepLabel.text('Step 4');
  storyTitle.text('First, watch the decade unfold.');
  storyText.text(`Following ${scenarioLabels[currentScenario]}, the map first loops across the U.S., then zooms into Texas and loops again through county-level change.`);

  scrollToMap();

  loopYearsThenTexas(() => {
    scrollToStory();
  });
}
    else if (storyStep === 4) {
    const target = storyTargets[currentScenario].increase;
    stepLabel.text('Step 5');
    storyTitle.text('Where does projected warming stand out most?');
    storyText.text(`${target} appears as the largest increase example for the selected pathway. The color shows projected temperature change since 2025.`);
    scrollToMap();
    zoomToNamedState(target, { highlight: true });

    d3.timeout(() => {
      scrollToStory();
    }, 1800);
  } else if (storyStep === 5) {
    const target = storyTargets[currentScenario].decrease;
    stepLabel.text('Step 6');
    storyTitle.text('A warmer future is not uniform everywhere.');
    storyText.text(`${target} appears as the largest decrease or coolest-change example for the selected pathway. Hover to compare all three emissions for the same year.`);
    scrollToMap();
    zoomToNamedState(target, { highlight: true });

    d3.timeout(() => {
      scrollToStory();
    }, 1800);
  } else if (storyStep === 6) {
    stepLabel.text('Takeaway');
    storyTitle.text('The finding: future change is spatially uneven.');
    storyText.text('Projected change is not uniform. Even under the same emissions pathway, some places may warm more while others show smaller increases or short-term cooling. Hover to compare pathways for the same year and location.');
    resetZoom({ quiet: true });
    setYear(2035);
  } else {
    stepLabel.text('Explore');
    storyTitle.text('Now explore your county and interested year.');
    storyText.text('Use the controls to choose a year and emission pathway. Click a state to zoom into counties, then hover for local values and same-year pathway comparisons.');
    continueButton.text('Restart story').property('disabled', false);
    setControlsEnabled(true);
    resetZoom({ quiet: true });
  }
}

function loopYearsThenTexas(onComplete) {
  setControlsEnabled(false);
  resetZoom({ quiet: true });

  let y = 2026;
  setYear(y);

  animationTimer = d3.interval(() => {
    y += 1;
    setYear(y);

    if (y >= 2035) {
      stopYearLoop();

      zoomToNamedState('Texas', { highlight: true });

      d3.timeout(() => {
        loopYearsWithinSelectedState(2026, 2035, onComplete);
      }, 900);
    }
  }, 520);
}

function loopYearsWithinSelectedState(startYear = 2026, endYear = 2035, onComplete) {
  let y = startYear;
  setYear(y);

  animationTimer = d3.interval(() => {
    y += 1;
    setYear(y);

    if (y >= endYear) {
      stopYearLoop();
      setYear(endYear);

      if (typeof onComplete === 'function') {
        d3.timeout(onComplete, 900);
      }
    }
  }, 520);
}

function stopYearLoop() {
  if (animationTimer) {
    animationTimer.stop();
    animationTimer = null;
  }
}

function setYear(year) {
  currentYear = year;
  yearSlider.property('value', year);
  yearLabel.text(year);
  updateMap();
  updateLegend();
}

function zoomToNamedState(name, options = {}) {
  const feature = stateFeatureByName.get(normalizeStateName(name));
  if (!feature) return;
  zoomToState(feature, { updateStory: false, highlight: options.highlight });
}

function updateMap() {
  updateColorScale();

  statesLayer.selectAll('path')
    .attr('fill', d => colorFor(getStateRow(d)))
    .classed('outside-state', d => selectedState && getStateName(d) !== selectedState);

  countiesLayer.selectAll('path')
    .classed('hidden-county', d => !selectedState || getCountyStateName(d) !== selectedState)
    .attr('fill', d => colorFor(getCountyRow(d)));
}

function updateColorScale() {
  currentColorLimit = selectedState ? globalCountyColorLimit : globalStateColorLimit;

  colorScale = d3.scaleDiverging(
    [-currentColorLimit, 0, currentColorLimit],
    t => d3.interpolateRdBu(1 - t)
  );
}

function colorFor(row) {
  if (!row || !Number.isFinite(row.temp_change_from_2025_c)) return '#e7ded3';
  const clipped = Math.max(-currentColorLimit, Math.min(currentColorLimit, row.temp_change_from_2025_c));
  return colorScale(clipped);
}

function updateLegend() {
  const steps = d3.range(0, 1.01, 0.05).map(t => colorScale(-currentColorLimit + t * currentColorLimit * 2));
  d3.select('#legend').html(`
    <span class="legend-title">
    Projected change since 2025<br>
    <small>colors clipped to 95% range</small>
    </span>
    <div class="legend-row">
      <span>≤ ${fmtChange(-currentColorLimit)}</span>
      <div class="legend-gradient" style="background: linear-gradient(to right, ${steps.join(',')});"></div>
      <span>≥ ${fmtChange(currentColorLimit)}</span>
    </div>
  `);
}

function zoomToState(feature, opts = {}) {
  selectedState = getStateName(feature);
  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  const scale = Math.max(1, Math.min(8.2, 0.86 / Math.max(dx / width, dy / height)));
  const translate = [width / 2 - scale * x, height / 2 - scale * y];

  g.transition()
    .duration(820)
    .attr('transform', `translate(${translate[0]},${translate[1]}) scale(${scale})`)
    .on('end', () => {
      updateMap();
      if (opts.highlight) highlightState(selectedState);
    });

  outlineLayer.selectAll('path')
    .data([feature])
    .join('path')
    .attr('class', 'selected-outline')
    .attr('d', path);

  resetButton.classed('hidden', false);
  updateMap();
}

function resetZoom(options = {}) {
  hideTooltip();

  selectedState = null;
  clearHighlights();
  g.transition().duration(options.quiet ? 0 : 720).attr('transform', null);
  outlineLayer.selectAll('*').remove();
  resetButton.classed('hidden', true);
  updateMap();
  updateLegend();
}

function highlightState(stateName) {
  clearHighlights();
  statesLayer.selectAll('path')
    .classed('story-highlight', d => getStateName(d) === stateName);
}

function clearHighlights() {
  statesLayer.selectAll('path').classed('story-highlight', false);
  countiesLayer.selectAll('path').classed('story-highlight', false);
}

function handleStateMouseEnter(event, feature) {
  tooltipAnchor = event.currentTarget;
  const row = getStateRow(feature);
  showTooltip(event, tooltipHtml(getStateName(feature), row, 'State', getStateComparisonRows(feature)));
}

function handleCountyMouseEnter(event, feature) {
  tooltipAnchor = event.currentTarget;
  const row = getCountyRow(feature);
  const name = `${getCountyName(feature)}, ${getCountyStateName(feature)}`;
  showTooltip(event, tooltipHtml(name, row, 'County', getCountyComparisonRows(feature)));
}

function tooltipHtml(name, row, level, comparisonRows) {
  if (!row) return `<strong>${name}</strong><div>No data for this year/pathway.</div>`;
  const comparisonHtml = ['ssp126', 'ssp245', 'ssp585'].map(scenario => {
    const d = comparisonRows.get(scenario);
    const value = d ? fmtChange(d.temp_change_from_2025_c) : '—';
    return `<div>${scenarioShort[scenario]}: <strong>${value}</strong></div>`;
  }).join('');

  return `
    <strong>${name}</strong>
    <div class="muted">${level} · ${scenarioLabels[currentScenario]} · ${currentYear}</div>
    <div>Observed 2025: ${fmtTemp(row.observed_temp_2025_c)}</div>
    <div>Adjusted projected ${currentYear}: ${fmtTemp(row.projected_temp_c)}</div>
    <div>Change since 2025: <strong>${fmtChange(row.temp_change_from_2025_c)}</strong></div>
    <div class="compare">
      <div class="muted">Same-year pathway comparison</div>
      ${comparisonHtml}
    </div>
  `;
}

function showTooltip(event, html) {
  tooltip.html(html).style('opacity', 1);
  moveTooltip(event);
}

function moveTooltip(event) {
  if (!tooltipAnchor) return;

  const padding = 18;
  const gap = 18;

  const anchorRect = tooltipAnchor.getBoundingClientRect();
  const tooltipNode = tooltip.node();
  const tooltipRect = tooltipNode.getBoundingClientRect();

  const anchorCenterY = anchorRect.top + anchorRect.height / 2;

  const spaceRight = window.innerWidth - anchorRect.right;
  const spaceLeft = anchorRect.left;

  let left;

  // Prefer the side with more space, so the tooltip avoids covering the selected state/county.
  if (spaceRight >= tooltipRect.width + gap || spaceRight >= spaceLeft) {
    left = anchorRect.right + gap;
  } else {
    left = anchorRect.left - tooltipRect.width - gap;
  }

  let top = anchorCenterY - tooltipRect.height / 2;

  // Keep tooltip inside the browser window.
  left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
  top = Math.max(padding, Math.min(top, window.innerHeight - tooltipRect.height - padding));

  tooltip
    .style('left', `${left}px`)
    .style('top', `${top}px`);
}

function hideTooltip() {
  tooltip.style('opacity', 0);
  tooltipAnchor = null;
}

function getStateComparisonRows(feature) {
  const state = getStateName(feature);
  return new Map(['ssp126', 'ssp245', 'ssp585'].map(s => [s, stateByKey.get(stateKey(state, currentYear, s))]));
}
function getCountyComparisonRows(feature) {
  const fips = getCountyFips(feature);
  return new Map(['ssp126', 'ssp245', 'ssp585'].map(s => [s, countyByKey.get(countyKey(fips, currentYear, s))]));
}

function getStateRow(feature) {
  return stateByKey.get(stateKey(getStateName(feature), currentYear, currentScenario));
}
function getCountyRow(feature) {
  return countyByKey.get(countyKey(getCountyFips(feature), currentYear, currentScenario));
}
function stateKey(state, year, scenario) {
  return `${normalizeStateName(state)}|${year}|${scenario}`;
}
function countyKey(fips, year, scenario) {
  return `${String(fips).padStart(5, '0')}|${year}|${scenario}`;
}
function normalizeStateName(name) { return String(name || '').trim().toLowerCase(); }
function getStateName(feature) {
  return feature.properties.NAME || feature.properties.name || feature.properties.state || feature.properties.STATE_NAME || feature.properties.STATE || '';
}
function getCountyName(feature) {
  return feature.properties.NAME || feature.properties.name || feature.properties.county || feature.properties.COUNTY || 'Unknown county';
}
function getCountyStateName(feature) {
  return feature.properties.state || feature.properties.STATE_NAME || feature.properties.STATENAME || feature.properties.NAME_STATE || feature.properties.STATE || stateNameFromGeoId(feature.properties.STATEFP) || '';
}
function getCountyFips(feature) {
  return String(feature.properties.GEOID || feature.properties.geoid || feature.properties.county_fips || '').padStart(5, '0');
}
function stateNameFromGeoId(statefp) {
  const map = {
    '01':'Alabama','04':'Arizona','05':'Arkansas','06':'California','08':'Colorado','09':'Connecticut','10':'Delaware','11':'District of Columbia','12':'Florida','13':'Georgia','16':'Idaho','17':'Illinois','18':'Indiana','19':'Iowa','20':'Kansas','21':'Kentucky','22':'Louisiana','23':'Maine','24':'Maryland','25':'Massachusetts','26':'Michigan','27':'Minnesota','28':'Mississippi','29':'Missouri','30':'Montana','31':'Nebraska','32':'Nevada','33':'New Hampshire','34':'New Jersey','35':'New Mexico','36':'New York','37':'North Carolina','38':'North Dakota','39':'Ohio','40':'Oklahoma','41':'Oregon','42':'Pennsylvania','44':'Rhode Island','45':'South Carolina','46':'South Dakota','47':'Tennessee','48':'Texas','49':'Utah','50':'Vermont','51':'Virginia','53':'Washington','54':'West Virginia','55':'Wisconsin','56':'Wyoming'
  };
  return map[String(statefp).padStart(2, '0')] || '';
}
