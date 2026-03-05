# Sample Templates

Templates for generating test corpus samples used in precision calculation.

## Directory Structure

```
samples/
├── positive.md.tmpl    # Template for positive samples (should match rules)
├── negative.md.tmpl    # Template for negative samples (should NOT match)
└── README.md           # This file
```

## Usage

Templates are used by `sample-generator.sh` to create labeled test samples.

## Variables

Templates support these placeholders:
- `{{SAMPLE_ID}}` - Unique sample identifier
- `{{DOMAIN}}` - Domain (security/sanitization/audit)
- `{{DESCRIPTION}}` - Human-readable description
- `{{PATTERN}}` - The code/pattern content
- `{{GENERATED}}` - ISO timestamp

## Note

Currently, sample-generator.sh uses inline templates. These file templates
are reserved for future customization needs.
