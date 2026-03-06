# Blocked Sources — Three-Tier Classification

Source tier classification for external content fetched into `.library/.memory/.references/`. Applied by `research` and `exec` at fetch time, before any sanitisation. Cross-referenced from `skills/library/SKILL.md` and `injection-rules.md` (same directory).

## Three Tiers

### Tier 1: Reject (Do Not Store)

Content from these sources is rejected outright — not fetched, not stored, not referenced.

| Category | Examples | Rationale |
|----------|---------|-----------|
| Direct IP as `source_url` | `http://192.168.1.1/payload.sh` | No traceability; bypasses domain-level filtering |
| Known C2 / malware domains | (maintained externally; append to local `blocked-domains.txt`) | Confirmed malicious infrastructure |
| `.onion` / darknet addresses | `*.onion` | Anonymised infrastructure; no legitimate reference use case |

**Action**: Log rejection: `"Rejected source: <url> — Tier 1 (reject)"`; do not write any file; do not add to `.changelog`.

---

### Tier 2: High-Risk (Store with `injection_risk: high`)

Content from these sources is stored but automatically tagged `injection_risk: high`. The read-time `<external-reference>` isolation wrapper is always applied.

| Source | Rationale |
|--------|-----------|
| `glot.io` | Arbitrary-code text hosting; frequently used for payload relay |
| `pastebin.com` | Anonymous text hosting; common for attacker-controlled payloads |
| `pastecode.io` | Similar to pastebin |
| `paste.ee` | Similar |
| `hastebin.com` | Similar |
| `raw.githubusercontent.com` (non-official org) | Raw file hosting; attacker can update payload without changing URL |
| `gist.github.com` | Anonymous snippets; lacks repository integrity signals |
| `transfer.sh` | Ephemeral file hosting; designed for easy payload delivery |
| Any URL containing `/raw/` path segment on code-hosting platforms | Suggests fetching raw script content rather than rendered documentation |

**Note**: These platforms also host legitimate content. Content is stored but treated with maximum caution throughout its lifecycle. Re-sanitisation is mandatory on every staleness refresh.

**Action**: Store file; set `injection_risk: high`; apply full ten-category sanitisation; apply `<external-reference>` wrapper on all reads.

---

### Tier 3: Caution (Elevate `injection_risk` to minimum `medium`)

Content from these sources is stored with `injection_risk` elevated to at least `medium`. Prior sanitisation result may further upgrade to `high`.

| Category | Examples | Rationale |
|----------|---------|-----------|
| Free TLDs | `.tk`, `.ml`, `.cf`, `.ga`, `.gq` | Frequently abused; low registration cost enables bulk attack infrastructure |
| Newly registered domains | Any domain with registration date < 90 days ago | New domains are commonly registered for attack campaigns |
| Personal blogs / vanity sites | `myblog.wordpress.com`, `username.github.io` | No editorial oversight; content can change without notice |
| URL shorteners | `bit.ly`, `tinyurl.com`, `t.co`, `ow.ly` | Destination URL hidden; makes source-tier classification impossible |
| Undated content | Pages with no `last-modified` or publication date | Cannot assess staleness; may be silently updated |

**Action**: Store file; ensure `injection_risk ≥ medium`; apply full sanitisation; flag in `status` report.

---

## Official / Trusted Sources (No Tier Downgrade)

These source types receive no automatic risk elevation. Normal sanitisation still runs.

| Category | Examples |
|----------|---------|
| Official documentation sites | `docs.python.org`, `developer.mozilla.org`, `docs.rs`, `pkg.go.dev` |
| Academic / research repositories | `arxiv.org`, `dl.acm.org`, `ieeexplore.ieee.org` |
| Standards bodies | `ietf.org`, `w3.org`, `iso.org`, `owasp.org` |
| Official GitHub organisation repos | `raw.githubusercontent.com/python/...`, `raw.githubusercontent.com/microsoft/...` |
| Package registries | `npmjs.com`, `pypi.org`, `crates.io`, `rubygems.org` |
| Platform documentation | `aws.amazon.com/documentation`, `cloud.google.com/docs`, `learn.microsoft.com` |

These sources are NOT exempt from sanitisation — all content runs through all ten categories. Tier classification only sets the default `injection_risk` floor; actual findings can upgrade it.

---

## Configuration

### Adding to Tier 1 (Reject list)

Create or append to `$NB_WORKSPACES_LIBRARY/.blocked-domains.txt`:

```
# One domain per line; comments with #; wildcards with *
evil-c2-domain.com
*.malware-network.org
```

`research` and `exec` read this file before each fetch. `maintain --rebuild-index` validates existing references against the current list and flags any already-stored files from newly blocked domains.

### Overriding Tier 2 or 3 classification

For legitimate use cases (e.g., internal pastebin instance, private gist for testing):

```
# $NB_WORKSPACES_LIBRARY/.source-overrides.txt
# Format: domain TAB tier
# Tiers: trusted | caution | high-risk | reject
internal-docs.company.com    trusted
gist.github.com              caution   # downgrade from high-risk for this project
```

Overrides apply only to exact domain match. Subdomain wildcards (`*.`) are supported.

---

## URL Shortener Handling

If a source URL is detected as a URL shortener:

1. Attempt to resolve the final destination URL (follow redirects, max 5 hops)
2. Apply tier classification to the **resolved** URL, not the shortener URL
3. If resolution fails or results in another shortener: apply Tier 2 (high-risk)
4. Store `source_url` as the resolved URL; record original shortener in `injection_findings`:
   ```
   "resolved shortener: bit.ly/abc123 → https://actual-destination.com/page"
   ```

---

## Domain Age Check

To determine if a domain is newly registered (Tier 3 caution trigger):

```bash
# Use WHOIS to check registration date
whois <domain> | grep -i "creation date\|registered\|created" | head -1
```

If WHOIS is unavailable or times out: treat as unknown age → apply Tier 3 caution.

Domains with verified registration > 90 days ago and not on any tier list: default to normal processing (no elevated floor).
