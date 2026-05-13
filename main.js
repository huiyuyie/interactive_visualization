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
  ssp126: 'SSP126 · low emissions',
  ssp245: 'SSP245 · medium emissions',
  ssp585: 'SSP585 · high emissions',
};

const scenarioExplain = {
  ssp126: 'SSP126 represents a low-emissions pathway with stronger climate mitigation.',
  ssp245: 'SSP245 represents a medium-emissions pathway between low and high futures.',
  ssp585: 'SSP585 represents a high-emissions pathway with continued strong greenhouse gas emissions.',
};

const scenarioShort = {
  ssp126: 'Low',
  ssp245: 'Medium',
  ssp585: 'High',
};

const storyTargets = {
  ssp126: {
    2035: { increase: 'North Dakota', decrease: 'Tennessee' },
    2026: { increase: 'North Dakota', decrease: 'Washington' },
  },
  ssp245: {
    2035: { increase: 'North Dakota', decrease: 'Tennessee' },
    2026: { increase: 'North Dakota', decrease: 'Tennessee' },
  },
  ssp585: {
    2035: { increase: 'Oklahoma', decrease: 'Washington' },
    2026: { increase: 'North Dakota', decrease: 'Tennessee' },
  },
};

const svg = d3.select('#map');
const tooltip = d3.select('#tooltip');
const yearSlider = d3.select('#year-slider');
const yearLabel = d3.select('#year-label');
const scenarioSelect = d3.select('#scenario-select');
const resetButton = d3.select('#reset-button');
const continueButton = d3.select('#continue-button');
const storyCard = d3.select('#story-card');
const storyTitle = d3.select('#story-title');
const storyText = d3.select('#story-text');
const stepLabel = d3.select('#step-label');
const scenarioChoice = d3.select('#story-scenario-choice');
const compareChoice = d3.select('#story-compare-choice');

let width = 960;
let height = 640;
let currentScenario = null;
let followedScenario = null;
let currentYear = 2035;
let selectedState = null;
let storyStep = 0;
let userPickedScenario = false;
let animationTimer = null;
let loaded = false;
let comparisonIndex = 0;
let showDataMap = false;

function isStoryActive() {
  return !storyCard.classed('hidden');
}

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

const FIXED_COLOR_LIMIT = 3.5;
let currentColorLimit = FIXED_COLOR_LIMIT;
let colorScale = d3.scaleDiverging([-FIXED_COLOR_LIMIT, 0, FIXED_COLOR_LIMIT], t => divergingColor(t));

Promise.all([
  d3.json(FILES.statesGeo),
  d3.json(FILES.countiesGeo),
  d3.csv(FILES.stateCsv, d3.autoType),
  d3.csv(FILES.countyCsv, d3.autoType),
]).then(([states, counties, sRows, cRows]) => {
  statesGeo = { ...states, features: states.features.filter(d => !CONUS_EXCLUDE.has(getStateName(d))) };
  countiesGeo = { ...counties, features: counties.features.filter(d => !CONUS_EXCLUDE.has(getCountyStateName(d))) };

  stateRows = normalizeRows(sRows, 'state').filter(d => !CONUS_EXCLUDE.has(d.state));
  countyRows = normalizeRows(cRows, 'county').filter(d => !CONUS_EXCLUDE.has(d.state));

  setupData();
  setupMap();
  loaded = true;
  updateMap();
  updateLegend();
  setControlsEnabled(false);
  updateStoryStep(0);
}).catch(error => {
  console.error(error);
  storyTitle.text('Could not load data');
  storyText.text('Check that the CSV and GeoJSON files are inside the data/ folder and match the expected filenames.');
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
}

function setupMap() {
  resizeSvg();
  window.addEventListener('resize', () => {
    resizeSvg();
    updateMap();
  });

  statesLayer.selectAll('path')
    .data(statesGeo.features)
    .join('path')
    .attr('class', 'state')
    .attr('d', path)
    .on('mouseenter', handleStateMouseEnter)
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip)
    .on('click', (event, d) => {
      if (isStoryActive() || animationTimer) return;
      const stateName = getStateName(d);
      if (selectedState === stateName) resetZoom();
      else zoomToState(d, { updateStory: false });
    });

  countiesLayer.selectAll('path')
    .data(countiesGeo.features)
    .join('path')
    .attr('class', 'county hidden-county')
    .attr('d', path)
    .on('mouseenter', handleCountyMouseEnter)
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip)
    .on('click', event => {
      event.stopPropagation();
      if (isStoryActive() || animationTimer) return;
    });

  scenarioSelect.on('change', event => {
    if (!event.target.value) return;
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

  resetButton.on('click', () => {
    if (isStoryActive() || animationTimer) return;
    resetZoom();
  });

  continueButton.on('click', () => {
    if (continueButton.property('disabled')) return;
    if (storyStep === 3 && !userPickedScenario) return;
    if (storyStep === 11 || storyStep === 12) {
      handleComparisonContinue();
      return;
    }
    updateStoryStep(storyStep + 1);
  });

  scenarioChoice.selectAll('button').on('click', event => {
    currentScenario = event.currentTarget.dataset.scenario;
    followedScenario = currentScenario;
    userPickedScenario = true;
    scenarioSelect.property('value', currentScenario);
    setScenarioChoiceActive(currentScenario);
    updateMap();
    updateLegend();
    continueButton.text('Continue').property('disabled', false);
  });

  compareChoice.selectAll('button').on('click', event => {
    const action = event.currentTarget.dataset.action;
    if (action === 'back') {
      updateStoryStep(3);
    } else {
      comparisonIndex = 0;
      updateStoryStep(11);
    }
  });
}

function resizeSvg() {
  if (!statesGeo) return;
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

function setStoryMode(mode) {
  storyCard.classed('full', mode === 'full');
  storyCard.classed('side', mode === 'side');
  d3.select('body').classed('story-full-active', mode === 'full');
}

function setDataMapVisible(visible) {
  showDataMap = visible;
  if (loaded) {
    updateMap();
    updateLegend();
  }
}

function updateStoryStep(nextStep) {
  stopYearLoop();
  storyStep = nextStep;
  clearHighlights();
  scenarioChoice.classed('hidden', true);
  compareChoice.classed('hidden', true);
  continueButton.text('Continue').property('disabled', false).classed('hidden', false);

  if (!loaded) return;

  const shouldShowDataMap = storyStep >= 4 && Boolean(currentScenario);
  setDataMapVisible(shouldShowDataMap);

  if (storyStep === 0) {
    setStoryMode('full');
    setControlsEnabled(false);
    stepLabel.text('Before the story');
    storyTitle.html('Warmer Future or Cooler Future?<br><span class="title-subline">Projected U.S. Temperature Change Under Different Emission Pathways</span>');
    storyText.text('A decade-scale look at projected temperature change from a 2025 observed baseline.');
    setYear(2035);
    resetZoom({ quiet: true });
  } else if (storyStep === 1) {
    setStoryMode('full');
    stepLabel.text('Step 1');
    storyTitle.text('2025 just passed...');
    storyText.text('Before looking far into the future, let’s start with the near term: what could temperature change look like this year, and how might it shift within the next decade?');
    setYear(2026);
    resetZoom({ quiet: true });
  } else if (storyStep === 2) {
    setStoryMode('full');
    stepLabel.text('Step 2');
    storyTitle.text('We start from a real baseline.');
    storyText.text('The map uses observed 2025 temperature as the starting point. Using a delta-change method, we calculate how much each model changes from its own 2025 prediction, then apply that change to the observed 2025 baseline. Color represents change since 2025, not raw temperature.');
    setYear(2026);
    resetZoom({ quiet: true });
  } else if (storyStep === 3) {
    setStoryMode('full');
    stepLabel.text('Step 3');
    storyTitle.text('How should we expect emissions in the near future?');
    storyText.text('Choose one pathway to follow through the story. SSP126, SSP245, and SSP585 represent low, medium, and high emissions futures, with 2.6, 4.5, and 8.5 W/m² radiative forcing by 2100. The main story follows your chosen pathway; later, you can explore other pathways yourself.');
    scenarioChoice.classed('hidden', false);
    userPickedScenario = false;
    currentScenario = null;
    followedScenario = null;
    setDataMapVisible(false);
    hideTooltip();
    scenarioSelect.property('value', '');
    setScenarioChoiceActive(null);
    continueButton.text('Choose a pathway').property('disabled', true);
  } else if (storyStep === 4) {
    if (!currentScenario) {
      setDataMapVisible(false);
      updateStoryStep(3);
      return;
    }
    setDataMapVisible(true);
    setStoryMode('side');
    stepLabel.text('Step 4');
    storyTitle.text('First, watch the decade unfold.');
    storyText.text(`Following ${scenarioLabels[currentScenario]}, the map loops from 2026 to 2035 to show how projected temperature change evolves. ${scenarioExplain[currentScenario]}`);
    continueButton.text('Playing...').property('disabled', true);
    loopYearsNationalOnly();
  } else if (storyStep === 5) {
    setStoryMode('side');
    const target = storyTargets[currentScenario][2035].increase;
    stepLabel.text('Step 5');
    storyTitle.text('By 2035, where is the largest projected increase?');
    setYear(2035);
    zoomToNamedState(target, { highlight: true });
    storyText.text(`${target} is the largest projected increase example under ${scenarioLabels[currentScenario]} in 2035. This highlights where the end-of-decade warming signal stands out most in the selected pathway.`);
  } else if (storyStep === 6) {
    setStoryMode('side');
    const target = storyTargets[currentScenario][2035].decrease;
    stepLabel.text('Step 6');
    storyTitle.text('By 2035, where is the largest projected decrease?');
    setYear(2035);
    zoomToNamedState(target, { highlight: true });
    storyText.text(`${target} is the largest projected decrease example under ${scenarioLabels[currentScenario]} in 2035. The map shows that projected change can move in different directions across geography.`);
  } else if (storyStep === 7) {
    setStoryMode('side');
    stepLabel.text('Step 7');
    storyTitle.text('How about projected change this year?');
    storyText.text('Now the map returns to 2026, the first projected year in this decade window, to compare the start of the decade with the 2035 pattern.');
    setYear(2026);
    resetZoom({ quiet: true });
  } else if (storyStep === 8) {
    setStoryMode('side');
    const target = storyTargets[currentScenario][2026].increase;
    stepLabel.text('Step 8');
    storyTitle.text('In 2026, where is the largest projected increase?');
    setYear(2026);
    zoomToNamedState(target, { highlight: true });
    storyText.text(`${target} is the largest projected increase example in 2026 under ${scenarioLabels[currentScenario]}. Comparing this with 2035 shows whether the strongest increase location stays the same or shifts over the decade.`);
  } else if (storyStep === 9) {
    setStoryMode('side');
    const target = storyTargets[currentScenario][2026].decrease;
    stepLabel.text('Step 9');
    storyTitle.text('In 2026, where is the largest projected decrease?');
    setYear(2026);
    zoomToNamedState(target, { highlight: true });
    storyText.text(`${target} is the largest projected decrease example in 2026 under ${scenarioLabels[currentScenario]}. This gives a start-of-decade comparison to the 2035 decrease example.`);
  } else if (storyStep === 10) {
    setStoryMode('full');
    stepLabel.text('Compare pathways');
    storyTitle.text('Compare the other pathways?');
    storyText.text('Go back to choose a different emission pathway, or continue to compare the 2026 and 2035 largest increase/decrease examples for the two pathways you did not follow.');
    setYear(2026);
    resetZoom({ quiet: true });
    compareChoice.classed('hidden', false);
    continueButton.classed('hidden', true);
  } else if (storyStep === 11) {
    setStoryMode('side');
    comparisonIndex = 0;
    showOtherEmissionFinding(getOtherScenarios()[comparisonIndex], 2026, 'Step 11');
  } else if (storyStep === 12) {
    setStoryMode('side');
    comparisonIndex = 0;
    showOtherEmissionFinding(getOtherScenarios()[comparisonIndex], 2035, 'Step 12');
  } else if (storyStep === 13) {
    setStoryMode('full');
    stepLabel.text('Finding');
    storyTitle.text('Emission pathways reshape regional temperature change over time.');
    storyText.text('Beyond the highlighted states, the map shows a broader regional shift: from 2026 to 2035, different emission pathways change where warming and cooling appear across the U.S.');
    setYear(2035);
    resetZoom({ quiet: true });
  } else if (storyStep === 14) {
    setStoryMode('full');
    stepLabel.text('Explore');
    storyTitle.text('Now explore your county and interested year.');
    storyText.text('Use the controls to choose a year and emission pathway. Click a state to zoom into counties, then hover for local Low, Medium, and High emission comparisons.');
    continueButton.text('Let me explore');
    setControlsEnabled(false);
  } else {
    // When the reader enters explore mode, return to the pathway they originally chose,
    // not the temporary pathway used during the comparison steps.
    currentScenario = followedScenario || currentScenario || 'ssp245';
    scenarioSelect.property('value', currentScenario);
    setScenarioChoiceActive(currentScenario);

    storyCard.classed('hidden', true);
    d3.select('body').classed('story-full-active', false);
    setControlsEnabled(true);
    resetZoom({ quiet: true });
    setYear(2035);
    updateMap();
    updateLegend();
  }
}


function getOtherScenarios() {
  return ['ssp126', 'ssp245', 'ssp585'].filter(scenario => scenario !== followedScenario);
}

function handleComparisonContinue() {
  const otherScenarios = getOtherScenarios();
  if (comparisonIndex === 0) {
    comparisonIndex = 1;
    const year = storyStep === 11 ? 2026 : 2035;
    showOtherEmissionFinding(otherScenarios[comparisonIndex], year, `Step ${storyStep}`);
  } else if (storyStep === 11) {
    comparisonIndex = 0;
    updateStoryStep(12);
  } else {
    comparisonIndex = 0;
    updateStoryStep(13);
  }
}

function showOtherEmissionFinding(scenario, year, stepLabelText) {
  const increaseState = storyTargets[scenario][year].increase;
  const decreaseState = storyTargets[scenario][year].decrease;
  const label = scenarioReadableLabel(scenario);
  const otherScenarios = getOtherScenarios();
  const isFirstOther = comparisonIndex === 0;

  // The comparison step intentionally switches to the other pathway being discussed,
  // while excluding the pathway the reader originally selected.
  currentScenario = scenario;
  scenarioSelect.property('value', scenario);
  setScenarioChoiceActive(scenario);
  setYear(year);
  resetZoom({ quiet: true });
  d3.timeout(() => highlightStates([increaseState, decreaseState], true), 80);

  stepLabel.text(stepLabelText);
  storyTitle.text(`${year}: ${label}`);
  storyText.text(`${label}: ${increaseState} has the largest projected increase, while ${decreaseState} has the largest projected decrease. The blinking orange outlines highlight these two states. ${isFirstOther ? 'Click Continue to compare the second pathway you did not follow.' : (year === 2026 ? 'Click Continue to compare the same idea at the end of the decade.' : 'Click Continue to see the final finding.')}`);
  continueButton.text(isFirstOther ? 'Next pathway' : (year === 2026 ? 'Next: 2035 comparison' : 'Continue to finding'));
}

function scenarioReadableLabel(scenario) {
  const labels = {
    ssp126: 'Low emissions (SSP126)',
    ssp245: 'Medium emissions (SSP245)',
    ssp585: 'High emissions (SSP585)',
  };
  return labels[scenario] || scenarioLabels[scenario] || scenario;
}

function loopYearsNationalOnly() {
  setControlsEnabled(false);
  resetZoom({ quiet: true });
  let y = 2026;
  setYear(y);

  animationTimer = d3.interval(() => {
    y += 1;
    setYear(y);
    if (y >= 2035) {
      stopYearLoop();
      setYear(2035);
      if (storyStep === 4) {
        continueButton.text('Continue').property('disabled', false);
      }
    }
  }, 520);
}

function loopYearsWithinSelectedState(startYear = 2026, endYear = 2035) {
  let y = startYear;
  setYear(y);
  animationTimer = d3.interval(() => {
    y += 1;
    setYear(y);
    if (y >= endYear) {
      stopYearLoop();
      setYear(endYear);
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
  if (!showDataMap || !currentScenario) {
    statesLayer.selectAll('path')
      .attr('fill', '#e8dfd4')
      .classed('outside-state', false);

    countiesLayer.selectAll('path')
      .classed('hidden-county', true)
      .attr('fill', '#e8dfd4');
    return;
  }

  updateColorScale();
  statesLayer.selectAll('path')
    .attr('fill', d => colorFor(getStateRow(d)))
    .classed('outside-state', d => selectedState && getStateName(d) !== selectedState);

  countiesLayer.selectAll('path')
    .classed('hidden-county', d => !selectedState || getCountyStateName(d) !== selectedState)
    .attr('fill', d => colorFor(getCountyRow(d)));
}

function updateColorScale() {
  currentColorLimit = FIXED_COLOR_LIMIT;
  colorScale = d3.scaleDiverging([-currentColorLimit, 0, currentColorLimit], t => divergingColor(t));
}

function divergingColor(t) {
  return d3.interpolateRgbBasis(['#225ea8', '#f7f2e8', '#b2182b'])(t);
}

function colorFor(row) {
  if (!row || !Number.isFinite(row.temp_change_from_2025_c)) return '#ddd3c6';
  const clipped = Math.max(-currentColorLimit, Math.min(currentColorLimit, row.temp_change_from_2025_c));
  return colorScale(clipped);
}

function updateLegend() {
  if (!showDataMap || !currentScenario) {
    d3.select('#legend').html('');
    return;
  }

  const steps = d3.range(0, 1.01, 0.05).map(t => colorScale(-currentColorLimit + t * currentColorLimit * 2));
  const leftLabel = `≤ ${fmtChange(-currentColorLimit)}`;
  const rightLabel = `≥ ${fmtChange(currentColorLimit)}`;
  const endpointNote = 'Color endpoints show the displayed range; values beyond the endpoints use the endpoint color.';

  d3.select('#legend').html(`
    <span class="legend-title">Projected change since 2025</span>
    <div class="legend-row">
      <span>${leftLabel}</span>
      <div class="legend-gradient" style="background: linear-gradient(to right, ${steps.join(',')});"></div>
      <span>${rightLabel}</span>
    </div>
    <div class="legend-note">Average temperature by year</div>
    <div class="legend-note endpoint-note">${endpointNote}</div>
  `);
}

function zoomToState(feature, opts = {}) {
  selectedState = getStateName(feature);
  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  // Adaptive zoom: small states still become readable, while large or skinny
  // interior states keep more surrounding context so the story card does not cover them.
  const maxRatio = Math.max(dx / width, dy / height);
  const minRatio = Math.min(dx / width, dy / height);
  const aspectRatio = maxRatio / Math.max(minRatio, 0.0001);

  let maxZoom = 6.0;
  let targetPadding = 0.66;
  if (maxRatio < 0.11) {
    maxZoom = 8.4;
    targetPadding = 0.74;
  } else if (maxRatio < 0.17) {
    maxZoom = 7.0;
    targetPadding = 0.70;
  }
  if (maxRatio > 0.30 || aspectRatio > 3.4) {
    maxZoom = 4.8;
    targetPadding = 0.52;
  }

  const scale = Math.max(1, Math.min(maxZoom, targetPadding / maxRatio));
  const translate = [width / 2 - scale * x, height / 2 - scale * y];

  g.transition()
    .duration(760)
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

  resetButton.classed('hidden', isStoryActive());
  updateMap();
}

function resetZoom(options = {}) {
  selectedState = null;
  clearHighlights();
  g.transition().duration(options.quiet ? 0 : 650).attr('transform', null);
  outlineLayer.selectAll('*').remove();
  resetButton.classed('hidden', true);
  updateMap();
  updateLegend();
}

function highlightState(stateName) {
  highlightStates([stateName], false);
}

function highlightStates(stateNames, blink = false) {
  clearHighlights();
  const targetSet = new Set(stateNames.map(normalizeStateName));
  statesLayer.selectAll('path')
    .classed('story-highlight', d => targetSet.has(normalizeStateName(getStateName(d))))
    .classed('blinking-highlight', d => blink && targetSet.has(normalizeStateName(getStateName(d))));
}

function clearHighlights() {
  statesLayer.selectAll('path').classed('story-highlight', false).classed('blinking-highlight', false);
  countiesLayer.selectAll('path').classed('story-highlight', false).classed('blinking-highlight', false);
}

function handleStateMouseEnter(event, feature) {
  showTooltip(event, tooltipHtml(getStateName(feature), 'State', getStateComparisonRows(feature)));
}

function handleCountyMouseEnter(event, feature) {
  const name = `${getCountyName(feature)}, ${getCountyStateName(feature)}`;
  showTooltip(event, tooltipHtml(name, 'County', getCountyComparisonRows(feature)));
}

function tooltipHtml(name, level, comparisonRows) {
  const comparisonHtml = ['ssp126', 'ssp245', 'ssp585'].map(scenario => {
    const d = comparisonRows.get(scenario);
    const value = d ? fmtChange(d.temp_change_from_2025_c) : '—';
    const cls = scenario === currentScenario ? 'compare-row current-emission' : 'compare-row';
    return `<div class="${cls}"><span>${scenarioShort[scenario]}:</span><strong>${value}</strong></div>`;
  }).join('');

  return `
    <strong>${name}</strong>
    <div class="muted">${level} · ${currentYear}</div>
    <div class="compare-title">Change since 2025</div>
    ${comparisonHtml}
  `;
}

function showTooltip(event, html) {
  tooltip.html(html).style('opacity', 1);
  moveTooltip(event);
}
function moveTooltip(event) {
  tooltip.style('left', `${event.clientX + 14}px`).style('top', `${event.clientY + 14}px`);
}
function hideTooltip() { tooltip.style('opacity', 0); }

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
