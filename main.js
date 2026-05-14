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

const emissionLabels = {
  ssp126: 'Low emissions',
  ssp245: 'Medium emissions',
  ssp585: 'High emissions',
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

const scenarioTakeaways = {
  ssp126: {
    title: 'Finding under Low emissions: gradual central U.S. change.',
    text: 'By 2035, projected change remains relatively gradual across the central U.S.'
  },
  ssp245: {
    title: 'Finding under Medium emissions: mixed central U.S. change.',
    text: 'By 2035, projected change becomes more mixed across the central U.S.'
  },
  ssp585: {
    title: 'Finding under High emissions: stronger and more spread-out increases.',
    text: 'By 2035, projected increases become stronger and more spread out across the central U.S.'
  }
};

const storyTargets = {
  ssp126: {
    2035: { increase: 'North Dakota' },
    2026: { increase: 'North Dakota' },
  },
  ssp245: {
    2035: { increase: 'North Dakota' },
    2026: { increase: 'North Dakota' },
  },
  ssp585: {
    2035: { increase: 'Oklahoma' },
    2026: { increase: 'North Dakota' },
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
const pageTitle = d3.select('.page-title h1');
const pageSubtitle = d3.select('.page-title p');
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
let showDataMap = false;

function isStoryActive() {
  // During final free exploration, storyStep is past 12. The takeaway card stays visible,
  // but the map should still be clickable.
  return !storyCard.classed('hidden') && storyStep <= 12;
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

  // Counties are rendered lazily only after a state is selected.
  // This keeps the initial map and story animation much faster.

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
    if (storyStep === 4 && !userPickedScenario) return;

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

  compareChoice.selectAll('button')
    .text(function () {
      return this.dataset.action === 'back' ? 'Choose a new pathway' : 'Continue to finding';
    })
    .on('click', event => {
      const action = event.currentTarget.dataset.action;

      if (action === 'back') {
        updateStoryStep(4);
      } else {
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
  storyCard.classed('full', false);
  storyCard.classed('side', true);
  d3.select('body').classed('story-full-active', false);
}

function setPageHeader(
  title,
  subtitle = 'Choose an emission pathway and year to compare projected change from the 2025 observed baseline.'
) {
  pageTitle.html(title);
  pageSubtitle.text(subtitle);
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

  const shouldShowDataMap = storyStep >= 5 && Boolean(currentScenario);
  setDataMapVisible(shouldShowDataMap);

  if (storyStep === 0) {
    setStoryMode('side');
    setControlsEnabled(false);
    setPageHeader('<span class="accent-word">Emission</span> Level and Projected Temperature Change in the U.S. (2026–2035)');

    stepLabel.text('Before the story');
    storyTitle.html('Today’s Emissions Shape Tomorrow’s Temperature Change');
    storyText.text('A decade-scale look at projected U.S. temperature change from a 2025 observed baseline.');
    setYear(2035);
    resetZoom({ quiet: true });

  } else if (storyStep === 1) {
    setStoryMode('side');

    stepLabel.text('Step 1');
    storyTitle.text('Emissions are already high today.');
    storyText.text('2025 emissions are already at 38.1 GtCO₂ (gigatonne of carbon dioxide). The question is no longer only how much we emit, but where those emissions may reshape temperature change next.');
    setYear(2026);
    resetZoom({ quiet: true });

  } else if (storyStep === 2) {
    setStoryMode('side');

    stepLabel.text('Step 2');
    storyTitle.html('Even <span class="title-highlight">0.1°C</span> can matter.');
    storyText.html(`
      <span class="fact-emphasis">Small increases can make risks larger.</span>
      <br><br>
      IPCC notes that each additional <strong>0.1°C of global warming</strong> can increase the intensity and frequency of temperature extremes, precipitation extremes, and drought risks in some regions.
    `);

  setYear(2026);
  resetZoom({ quiet: true });

  } else if (storyStep === 3) {
    setStoryMode('side');

    stepLabel.text('Step 3');
    storyTitle.text('So we measure change from a real baseline.');
    storyText.text('The map uses observed 2025 temperature as the starting point. Using a delta-change method, we calculate how much each model changes from its own 2025 prediction, then apply that change to the observed 2025 baseline. Color represents change since 2025, not raw temperature.');
    setYear(2026);
    resetZoom({ quiet: true });

  } else if (storyStep === 4) {
    setStoryMode('side');

    stepLabel.text('Step 4');
    storyTitle.text('Now choose an emissions future to see how warming may unfold.');
    storyText.text('Choose one pathway to follow through the story. In this visualization, Low, Medium, and High emissions correspond to SSP126, SSP245, and SSP585, with 2.6, 4.5, and 8.5 W/m² radiative forcing by 2100. Later, you can compare the other pathways.');

    scenarioChoice.classed('hidden', false);
    userPickedScenario = false;
    currentScenario = null;
    followedScenario = null;

    setDataMapVisible(false);
    hideTooltip();
    scenarioSelect.property('value', '');
    setScenarioChoiceActive(null);
    continueButton.text('Choose a pathway').property('disabled', true);

  } else if (storyStep === 5) {
    if (!currentScenario) {
      setDataMapVisible(false);
      updateStoryStep(4);
      return;
    }

    setDataMapVisible(true);
    setStoryMode('side');

    const target = storyTargets[currentScenario][2026].increase;

    stepLabel.text('Step 5');
    storyTitle.text('First, start with 2026.');
    setYear(2026);
    zoomToNamedState(target, { highlight: true });
    storyText.text(`Under ${emissionLabels[currentScenario]}, ${target} has the largest projected warming in 2026, giving us a starting point before the decade unfolds.`);

  } else if (storyStep === 6) {
    setDataMapVisible(true);
    setStoryMode('side');

    stepLabel.text('Step 6');
    storyTitle.text('Now watch the decade unfold.');
    storyText.text(`The map now loops from 2026 to 2035, showing how warming patterns shift across the U.S. under ${emissionLabels[currentScenario]}.`);
    continueButton.text('Playing...').property('disabled', true);
    loopYearsNationalOnly();

  } else if (storyStep === 7) {
    setStoryMode('side');

    const startTarget = storyTargets[currentScenario][2026].increase;
    const endTarget = storyTargets[currentScenario][2035].increase;
    const changedTarget = startTarget !== endTarget;

    stepLabel.text('Step 7');
    storyTitle.text('By 2035, where does warming stand out most?');
    setYear(2035);
    zoomToNamedState(endTarget, { highlight: true });

    storyText.text(
    changedTarget
      ? `Under ${emissionLabels[currentScenario]}, ${endTarget} becomes the largest projected warming example, shifting from ${startTarget} in 2026.`
      : `Under ${emissionLabels[currentScenario]}, ${endTarget} remains the largest projected warming example from 2026 to 2035.`
  );

  } else if (storyStep === 8) {
    setStoryMode('side');

    stepLabel.text('Step 8');
    storyTitle.text('Follow another pathway or continue?');
    storyText.text('Choose a new emissions future to replay the story, or continue to the finding from this pathway.');

    setYear(2035);
    resetZoom({ quiet: true });
    compareChoice.classed('hidden', false);
    continueButton.classed('hidden', true);

  } else if (storyStep === 11) {
    setStoryMode('side');

    const selectedScenario = followedScenario || currentScenario || 'ssp245';
    const takeaway = scenarioTakeaways[selectedScenario];

    currentScenario = selectedScenario;
    scenarioSelect.property('value', currentScenario);
    setScenarioChoiceActive(currentScenario);

    setPageHeader(takeaway.title, takeaway.text);

    stepLabel.text('Finding');
    storyTitle.text(takeaway.title);
    storyText.text(takeaway.text);

    setYear(2035);
    resetZoom({ quiet: true });

  } else if (storyStep === 12) {
    setStoryMode('side');

    const selectedScenario = followedScenario || currentScenario || 'ssp245';
    const takeaway = scenarioTakeaways[selectedScenario];

    currentScenario = selectedScenario;
    scenarioSelect.property('value', currentScenario);
    setScenarioChoiceActive(currentScenario);

    setPageHeader(takeaway.title, takeaway.text);

    stepLabel.text('Finding');
    storyTitle.text(takeaway.title);
    storyText.text(`${takeaway.text} Use the controls to change year or pathway. Click a state to zoom into counties, then hover to compare Low, Medium, and High emissions locally.`);

    continueButton.text('Let me explore');
    setControlsEnabled(false);

  } else {
    currentScenario = followedScenario || currentScenario || 'ssp245';
    const takeaway = scenarioTakeaways[currentScenario];

    scenarioSelect.property('value', currentScenario);
    setScenarioChoiceActive(currentScenario);

    setPageHeader(takeaway.title, takeaway.text);

    storyCard.classed('hidden', false);
    setStoryMode('side');

    stepLabel.text('Finding');
    storyTitle.text(takeaway.title);
    storyText.text(takeaway.text);
    continueButton.classed('hidden', true);

    d3.select('body').classed('story-full-active', false);
    setControlsEnabled(true);
    resetZoom({ quiet: true });
    setYear(2035);
    updateMap();
    updateLegend();
  }
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

      if (storyStep === 6) {
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

function renderSelectedStateCounties() {
  if (!selectedState) {
    countiesLayer.selectAll('path').remove();
    return;
  }

  const selectedCounties = countiesGeo.features.filter(
    d => getCountyStateName(d) === selectedState
  );

  countiesLayer.selectAll('path')
    .data(selectedCounties, d => getCountyFips(d))
    .join(
      enter => enter.append('path')
        .attr('class', 'county')
        .attr('d', path)
        .on('mouseenter', handleCountyMouseEnter)
        .on('mousemove', moveTooltip)
        .on('mouseleave', hideTooltip)
        .on('click', event => {
          event.stopPropagation();
          if (isStoryActive() || animationTimer) return;
        }),
      update => update.attr('d', path),
      exit => exit.remove()
    );
}

function updateMap() {
  if (!showDataMap || !currentScenario) {
    statesLayer.selectAll('path')
      .attr('fill', '#e8dfd4')
      .classed('outside-state', false);

    countiesLayer.selectAll('path').remove();
    return;
  }

  updateColorScale();

  statesLayer.selectAll('path')
    .attr('fill', d => colorFor(getStateRow(d)))
    .classed('outside-state', d => selectedState && getStateName(d) !== selectedState);

  renderSelectedStateCounties();

  if (selectedState) {
    countiesLayer.selectAll('path')
      .attr('fill', d => colorFor(getCountyRow(d)));
  }
}

function updateColorScale() {
  currentColorLimit = FIXED_COLOR_LIMIT;
  colorScale = d3.scaleDiverging([-currentColorLimit, 0, currentColorLimit], t => divergingColor(t));
}

function divergingColor(t) {
  if (t < 0.5) {
    return d3.interpolateRgb('#2166ac', '#ffffff')(t * 2);
  } else {
    return d3.interpolateRgb('#ffffff', '#b2182b')((t - 0.5) * 2);
  }
}

function colorFor(row) {
  if (!row || !Number.isFinite(row.temp_change_from_2025_c)) return '#ddd3c6';

  const clipped = Math.max(
    -currentColorLimit,
    Math.min(currentColorLimit, row.temp_change_from_2025_c)
  );

  return colorScale(clipped);
}

function updateLegend() {
  if (!showDataMap || !currentScenario) {
    d3.select('#legend').html('');
    return;
  }

  const steps = d3.range(0, 1.01, 0.05).map(t =>
    colorScale(-currentColorLimit + t * currentColorLimit * 2)
  );

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
      renderSelectedStateCounties();
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

  countiesLayer.selectAll('path').remove();

  g.transition()
    .duration(options.quiet ? 0 : 650)
    .attr('transform', null);

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
  statesLayer.selectAll('path')
    .classed('story-highlight', false)
    .classed('blinking-highlight', false);

  countiesLayer.selectAll('path')
    .classed('story-highlight', false)
    .classed('blinking-highlight', false);
}

function handleStateMouseEnter(event, feature) {
  d3.select(event.currentTarget).raise();
  showTooltip(event, tooltipHtml(getStateName(feature), 'State', getStateComparisonRows(feature)));
}

function handleCountyMouseEnter(event, feature) {
  d3.select(event.currentTarget).raise();
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
  tooltip
    .style('left', `${event.clientX + 14}px`)
    .style('top', `${event.clientY + 14}px`);
}

function hideTooltip() {
  tooltip.style('opacity', 0);
}

function getStateComparisonRows(feature) {
  const state = getStateName(feature);

  return new Map(['ssp126', 'ssp245', 'ssp585'].map(s => [
    s,
    stateByKey.get(stateKey(state, currentYear, s))
  ]));
}

function getCountyComparisonRows(feature) {
  const fips = getCountyFips(feature);

  return new Map(['ssp126', 'ssp245', 'ssp585'].map(s => [
    s,
    countyByKey.get(countyKey(fips, currentYear, s))
  ]));
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

function normalizeStateName(name) {
  return String(name || '').trim().toLowerCase();
}

function getStateName(feature) {
  return feature.properties.NAME ||
    feature.properties.name ||
    feature.properties.state ||
    feature.properties.STATE_NAME ||
    feature.properties.STATE ||
    '';
}

function getCountyName(feature) {
  return feature.properties.NAME ||
    feature.properties.name ||
    feature.properties.county ||
    feature.properties.COUNTY ||
    'Unknown county';
}

function getCountyStateName(feature) {
  return feature.properties.state ||
    feature.properties.STATE_NAME ||
    feature.properties.STATENAME ||
    feature.properties.NAME_STATE ||
    feature.properties.STATE ||
    stateNameFromGeoId(feature.properties.STATEFP) ||
    '';
}

function getCountyFips(feature) {
  return String(
    feature.properties.GEOID ||
    feature.properties.geoid ||
    feature.properties.county_fips ||
    ''
  ).padStart(5, '0');
}

function stateNameFromGeoId(statefp) {
  const map = {
    '01': 'Alabama',
    '04': 'Arizona',
    '05': 'Arkansas',
    '06': 'California',
    '08': 'Colorado',
    '09': 'Connecticut',
    '10': 'Delaware',
    '11': 'District of Columbia',
    '12': 'Florida',
    '13': 'Georgia',
    '16': 'Idaho',
    '17': 'Illinois',
    '18': 'Indiana',
    '19': 'Iowa',
    '20': 'Kansas',
    '21': 'Kentucky',
    '22': 'Louisiana',
    '23': 'Maine',
    '24': 'Maryland',
    '25': 'Massachusetts',
    '26': 'Michigan',
    '27': 'Minnesota',
    '28': 'Mississippi',
    '29': 'Missouri',
    '30': 'Montana',
    '31': 'Nebraska',
    '32': 'Nevada',
    '33': 'New Hampshire',
    '34': 'New Jersey',
    '35': 'New Mexico',
    '36': 'New York',
    '37': 'North Carolina',
    '38': 'North Dakota',
    '39': 'Ohio',
    '40': 'Oklahoma',
    '41': 'Oregon',
    '42': 'Pennsylvania',
    '44': 'Rhode Island',
    '45': 'South Carolina',
    '46': 'South Dakota',
    '47': 'Tennessee',
    '48': 'Texas',
    '49': 'Utah',
    '50': 'Vermont',
    '51': 'Virginia',
    '53': 'Washington',
    '54': 'West Virginia',
    '55': 'Wisconsin',
    '56': 'Wyoming'
  };

  return map[String(statefp).padStart(2, '0')] || '';
}