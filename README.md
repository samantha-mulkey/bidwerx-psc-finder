# BidWERX PSC Finder

A zero-recurring-cost Product Service Code finder for a Webflow site.

## How it works

The official Acquisition.gov PSC workbook is normalized and converted into a compact client-side search model. The browser performs a hybrid search using:

1. latent semantic analysis (TF-IDF + truncated SVD),
2. phrase/query expansion for common contracting language, and
3. direct lexical matching against official PSC titles and descriptions.

There is no paid API, server, database, or API key.

## Production pieces

The files Webflow needs are in `dist/`:

- `psc-records.json` - active PSC records and official descriptive text
- `psc-model.json` - vocabulary and model metadata
- `psc-idf.f32` - TF-IDF weights
- `psc-components.f32` - semantic projection matrix
- `psc-doc-vectors.f32` - precomputed PSC vectors
- `query-aliases.json` - common-language query expansions
- `manifest.json` - dataset/model metadata

The Webflow integration script is:

- `webflow/psc-finder.js`

## Webflow element IDs

The script expects these unique IDs:

- `psc-search-form`
- `psc-search-input`
- `psc-empty-state`
- `psc-loading-state`
- `psc-results-content`
- `psc-results-grid`
- `psc-results-count`
- `psc-result-template`

The preset chips only need the shared class:

- `psc-preset-chip`

The elements inside the result template use shared classes:

- `psc-code`
- `psc-badge`
- `psc-result-title`
- `psc-result-description`
- `psc-copy-button`

Badge combo classes:

- `is-green` = Best Match
- `is-yellow` = Possible Match

## Put it on GitHub

1. Create a GitHub repository named `bidwerx-psc-finder`.
2. Upload the contents of this folder to the repository.
3. Keep the repository public if Webflow visitors need to fetch the static data directly from `raw.githubusercontent.com`.
4. Open `webflow/psc-finder.js` and replace `YOUR_GITHUB_USERNAME` with the GitHub account or organization name that owns the repository.
5. Paste the JavaScript from `webflow/psc-finder.js` into Webflow before the closing `</body>` tag, wrapped in `<script>...</script>`.
6. Publish the Webflow site and test a search.

## Important GitHub note

This setup uses GitHub only as a public static-file source for the model/data. The actual finder runs inside the visitor's browser on the Webflow page. No search queries are sent to GitHub or a paid AI service.

## Refreshing the PSC data later

When Acquisition.gov publishes a new PSC workbook:

1. Replace `data/PSC_April_2025.xlsx` with the new workbook.
2. Update/run your normalization step to regenerate `data/psc-normalized.json`.
3. Run `python scripts/build_search_model.py`.
4. Commit the updated `dist/` files to GitHub.

## Local model rebuild

Install Python 3, then from the repository folder:

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python scripts/build_search_model.py
```

## Data source

Acquisition.gov Product and Service Codes, April 2025 workbook. The source URL is preserved in `data/psc-normalized.json`.
