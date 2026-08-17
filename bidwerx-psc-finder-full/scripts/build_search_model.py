#!/usr/bin/env python3
import json, re
from pathlib import Path
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from sklearn.preprocessing import Normalizer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
DIST = ROOT / 'dist'
DIST.mkdir(parents=True, exist_ok=True)

with (DATA / 'psc-normalized.json').open(encoding='utf-8') as f:
    source = json.load(f)
records = source['records']

def clean(value):
    return re.sub(r'\s+', ' ', (value or '').strip())

def index_text(r):
    title = clean(r.get('title'))
    parts = [
        title, title,
        clean(r.get('level1_category')),
        clean(r.get('level2_category')),
        clean(r.get('description')),
        clean(r.get('includes')),
        clean(r.get('notes')),
        clean(r.get('parent')),
    ]
    return ' '.join(p for p in parts if p)

texts = [index_text(r) for r in records]
vectorizer = TfidfVectorizer(
    lowercase=True,
    strip_accents='unicode',
    stop_words='english',
    ngram_range=(1, 2),
    max_features=8000,
    sublinear_tf=True,
    norm='l2',
    dtype=np.float32,
)
X = vectorizer.fit_transform(texts)
svd = TruncatedSVD(n_components=128, random_state=42)
normalizer = Normalizer(copy=False)
doc_vectors = normalizer.fit_transform(svd.fit_transform(X)).astype(np.float32)

browser_records = []
for r, text in zip(records, texts):
    official_description = clean(r.get('description'))
    includes = clean(r.get('includes'))
    description = official_description or includes or clean(r.get('level2_category')) or clean(r.get('level1_category'))
    browser_records.append({
        'code': str(r.get('code', '')),
        'title': clean(r.get('title')),
        'description': description,
        'includes': includes,
        'level1': clean(r.get('level1_category')),
        'level2': clean(r.get('level2_category')),
        'search': clean(text).lower(),
    })

with (DIST / 'psc-records.json').open('w', encoding='utf-8') as f:
    json.dump({
        'source': source['source'],
        'source_date': source['source_date'],
        'record_count': len(browser_records),
        'records': browser_records,
    }, f, separators=(',', ':'))

features = vectorizer.get_feature_names_out().tolist()
with (DIST / 'psc-model.json').open('w', encoding='utf-8') as f:
    json.dump({
        'version': 1,
        'dimensions': 128,
        'vocabulary': features,
        'explained_variance': float(svd.explained_variance_ratio_.sum()),
        'settings': {
            'ngrams': [1, 2],
            'sublinear_tf': True,
            'tfidf_norm': 'l2',
            'lsa_norm': 'l2',
        },
    }, f, separators=(',', ':'))

np.asarray(vectorizer.idf_, dtype='<f4').tofile(DIST / 'psc-idf.f32')
np.asarray(svd.components_.T, dtype='<f4').tofile(DIST / 'psc-components.f32')
np.asarray(doc_vectors, dtype='<f4').tofile(DIST / 'psc-doc-vectors.f32')

with (DIST / 'manifest.json').open('w', encoding='utf-8') as f:
    json.dump({
        'dataset': 'Acquisition.gov Product and Service Codes',
        'source_date': source['source_date'],
        'records': len(browser_records),
        'vocabulary': len(features),
        'dimensions': 128,
    }, f, indent=2)

print(f'Built {len(browser_records)} PSC records, {len(features)} vocabulary terms, 128 dimensions.')
