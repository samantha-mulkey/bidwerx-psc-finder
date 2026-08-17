(() => {
  'use strict';

  // CHANGE ONLY THIS LINE after you upload the repo to GitHub.
  const ASSET_BASE = 'https://raw.githubusercontent.com/samantha-mulkey/bidwerx-psc-finder/main/dist';

  const RESULT_LIMIT = 6;
  const selectors = {
    form: '#psc-search-form',
    input: '#psc-search-input',
    empty: '#psc-empty-state',
    loading: '#psc-loading-state',
    results: '#psc-results-content',
    grid: '#psc-results-grid',
    count: '#psc-results-count',
    template: '#psc-result-template',
    chips: '.psc-preset-chip',
  };

  let assetsPromise = null;

  function $(selector) {
    return document.querySelector(selector);
  }

  function show(el, display = 'flex') {
    if (el) el.style.display = display;
  }

  function hide(el) {
    if (el) el.style.display = 'none';
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(value) {
    return normalizeText(value)
      .split(' ')
      .filter((token) => token.length >= 2);
  }

  async function fetchJson(name) {
    const response = await fetch(`${ASSET_BASE}/${name}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Could not load ${name}`);
    return response.json();
  }

  async function fetchFloat32(name) {
    const response = await fetch(`${ASSET_BASE}/${name}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Could not load ${name}`);
    return new Float32Array(await response.arrayBuffer());
  }

  async function loadAssets() {
    if (assetsPromise) return assetsPromise;

    assetsPromise = Promise.all([
      fetchJson('psc-records.json'),
      fetchJson('psc-model.json'),
      fetchJson('query-aliases.json'),
      fetchFloat32('psc-idf.f32'),
      fetchFloat32('psc-components.f32'),
      fetchFloat32('psc-doc-vectors.f32'),
    ]).then(([recordFile, model, aliases, idf, components, docVectors]) => {
      const vocabMap = new Map();
      model.vocabulary.forEach((term, index) => vocabMap.set(term, index));
      return {
        records: recordFile.records,
        model,
        aliases,
        idf,
        components,
        docVectors,
        vocabMap,
      };
    });

    return assetsPromise;
  }

  function expandQuery(query, aliases) {
    const normalized = normalizeText(query);
    const additions = [];

    Object.entries(aliases).forEach(([phrase, expansion]) => {
      if (normalized.includes(normalizeText(phrase))) additions.push(expansion);
    });

    return `${query} ${additions.join(' ')}`.trim();
  }

  function buildQueryTerms(text) {
    const tokens = words(text);
    const terms = [...tokens];
    for (let i = 0; i < tokens.length - 1; i += 1) {
      terms.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return terms;
  }

  function queryVector(query, assets) {
    const expanded = expandQuery(query, assets.aliases);
    const terms = buildQueryTerms(expanded);
    const counts = new Map();

    terms.forEach((term) => {
      const idx = assets.vocabMap.get(term);
      if (idx !== undefined) counts.set(idx, (counts.get(idx) || 0) + 1);
    });

    if (!counts.size) return null;

    const weighted = [];
    let tfidfNormSq = 0;
    counts.forEach((count, idx) => {
      const weight = (1 + Math.log(count)) * assets.idf[idx];
      weighted.push([idx, weight]);
      tfidfNormSq += weight * weight;
    });

    const tfidfNorm = Math.sqrt(tfidfNormSq) || 1;
    const dims = assets.model.dimensions;
    const vector = new Float32Array(dims);

    weighted.forEach(([idx, rawWeight]) => {
      const weight = rawWeight / tfidfNorm;
      const offset = idx * dims;
      for (let d = 0; d < dims; d += 1) {
        vector[d] += weight * assets.components[offset + d];
      }
    });

    let normSq = 0;
    for (let d = 0; d < dims; d += 1) normSq += vector[d] * vector[d];
    const norm = Math.sqrt(normSq);
    if (!norm) return null;
    for (let d = 0; d < dims; d += 1) vector[d] /= norm;

    return { vector, expanded };
  }

  const GENERIC_WORDS = new Set([
    'and', 'the', 'for', 'with', 'from', 'that', 'this', 'our', 'your', 'services',
    'service', 'federal', 'government', 'commercial', 'company', 'provide', 'provides',
    'work', 'business', 'support', 'solutions', 'solution', 'system', 'systems'
  ]);

  function lexicalScore(originalQuery, expandedQuery, record) {
    const original = words(originalQuery).filter((w) => !GENERIC_WORDS.has(w));
    const expanded = words(expandedQuery).filter((w) => !GENERIC_WORDS.has(w));
    const title = normalizeText(record.title);
    const searchable = record.search || '';
    let score = 0;

    const exactPhrase = normalizeText(originalQuery);
    if (exactPhrase.length >= 4) {
      if (title.includes(exactPhrase)) score += 0.55;
      else if (searchable.includes(exactPhrase)) score += 0.30;
    }

    original.forEach((term) => {
      if (title.includes(term)) score += 0.10;
      else if (searchable.includes(term)) score += 0.045;
    });

    expanded.forEach((term) => {
      if (title.includes(term)) score += 0.018;
      else if (searchable.includes(term)) score += 0.008;
    });

    return Math.min(1, score);
  }

  function search(query, assets) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // Exact PSC-code lookup always wins.
    const exactCode = trimmed.toUpperCase().replace(/\s+/g, '');
    const exactIndex = assets.records.findIndex((record) => record.code.toUpperCase() === exactCode);
    if (exactIndex >= 0) {
      return [{ ...assets.records[exactIndex], score: 1, match: 'best' }];
    }

    const q = queryVector(trimmed, assets);
    if (!q) return [];

    const dims = assets.model.dimensions;
    const scored = new Array(assets.records.length);

    for (let i = 0; i < assets.records.length; i += 1) {
      const offset = i * dims;
      let semantic = 0;
      for (let d = 0; d < dims; d += 1) {
        semantic += q.vector[d] * assets.docVectors[offset + d];
      }
      semantic = Math.max(0, semantic);
      const lexical = lexicalScore(trimmed, q.expanded, assets.records[i]);
      const hybrid = (semantic * 0.70) + (lexical * 0.30);
      scored[i] = { index: i, score: hybrid, semantic, lexical };
    }

    scored.sort((a, b) => b.score - a.score);
    const topScore = scored[0]?.score || 0;
    if (topScore < 0.10) return [];

    const usable = scored
      .filter((item) => item.score >= Math.max(0.09, topScore * 0.42))
      .slice(0, RESULT_LIMIT);

    return usable.map((item, rank) => {
      const isBest = rank === 0 || (rank === 1 && item.score >= topScore * 0.93 && topScore >= 0.30);
      return {
        ...assets.records[item.index],
        score: item.score,
        match: isBest ? 'best' : 'possible',
      };
    });
  }

  function clearRenderedCards(grid, template) {
    if (!grid) return;
    [...grid.children].forEach((child) => {
      if (child !== template) child.remove();
    });
  }

  function renderResults(results) {
    const grid = $(selectors.grid);
    const template = $(selectors.template);
    const count = $(selectors.count);
    if (!grid || !template) throw new Error('PSC result template or grid is missing.');

    clearRenderedCards(grid, template);

    results.forEach((result) => {
      const card = template.cloneNode(true);
      card.removeAttribute('id');
      card.style.display = 'flex';

      const code = card.querySelector('.psc-code');
      const badge = card.querySelector('.psc-badge');
      const title = card.querySelector('.psc-result-title');
      const description = card.querySelector('.psc-result-description');
      const copyButton = card.querySelector('.psc-copy-button');

      if (code) code.textContent = result.code;
      if (title) title.textContent = result.title;
      if (description) description.textContent = result.description || 'See the official PSC title for this classification.';

      if (badge) {
        badge.classList.remove('is-green', 'is-yellow');
        if (result.match === 'best') {
          badge.classList.add('is-green');
          badge.textContent = 'Best Match';
        } else {
          badge.classList.add('is-yellow');
          badge.textContent = 'Possible Match';
        }
      }

      if (copyButton) {
        const defaultText = `Copy ${result.code}`;
        copyButton.textContent = defaultText;
        copyButton.addEventListener('click', async (event) => {
          event.preventDefault();
          try {
            await navigator.clipboard.writeText(result.code);
            copyButton.textContent = 'Copied!';
            setTimeout(() => { copyButton.textContent = defaultText; }, 1400);
          } catch (_) {
            copyButton.textContent = result.code;
          }
        });
      }

      grid.appendChild(card);
    });

    if (count) count.textContent = `${results.length} ${results.length === 1 ? 'code' : 'codes'} matched`;
  }

  function setState(state) {
    const empty = $(selectors.empty);
    const loading = $(selectors.loading);
    const results = $(selectors.results);

    hide(empty);
    hide(loading);
    hide(results);

    if (state === 'empty') show(empty, 'flex');
    if (state === 'loading') show(loading, 'flex');
    if (state === 'results') show(results, 'flex');
  }

  async function runSearch(query) {
    const input = $(selectors.input);
    const value = String(query ?? input?.value ?? '').trim();
    if (!value) {
      setState('empty');
      if (input) input.focus();
      return;
    }

    if (input) input.value = value;
    setState('loading');

    try {
      const assets = await loadAssets();
      const results = search(value, assets);

      if (!results.length) {
        const empty = $(selectors.empty);
        if (empty) {
          const heading = empty.querySelector('h1,h2,h3,h4,h5,h6,.psc-empty-heading');
          const text = empty.querySelector('p,.psc-empty-text');
          if (heading) heading.textContent = 'No strong PSC matches found';
          if (text) text.textContent = 'Try a broader capability, service, product, or a four-character PSC code.';
        }
        setState('empty');
        return;
      }

      renderResults(results);
      setState('results');
    } catch (error) {
      console.error('[BidWERX PSC Finder]', error);
      const empty = $(selectors.empty);
      if (empty) {
        const heading = empty.querySelector('h1,h2,h3,h4,h5,h6,.psc-empty-heading');
        const text = empty.querySelector('p,.psc-empty-text');
        if (heading) heading.textContent = 'PSC Finder could not load';
        if (text) text.textContent = 'Check the GitHub asset URL in the finder script and try again.';
      }
      setState('empty');
    }
  }

  function init() {
    const form = $(selectors.form);
    const input = $(selectors.input);
    const template = $(selectors.template);

    if (!form || !input) {
      console.warn('[BidWERX PSC Finder] Search form or input not found.');
      return;
    }

    if (template) template.style.display = 'none';
    setState('empty');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      runSearch(input.value);
    });

    document.querySelectorAll(selectors.chips).forEach((chip) => {
      chip.addEventListener('click', (event) => {
        event.preventDefault();
        const query = chip.textContent.trim();
        input.value = query;
        runSearch(query);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
