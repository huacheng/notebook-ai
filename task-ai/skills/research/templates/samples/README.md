# Sample Templates

Templates for generating test corpus samples used in precision calculation.

## Overview

`sample-generator.sh` generates labeled positive/negative test samples for
precision calculation. Samples are created using inline templates in the script.

## Supported Placeholders (inline)

- `SAMPLE_ID` - Unique sample identifier
- `DOMAIN` - Domain (security/sanitization/audit)
- `DESCRIPTION` - Human-readable description
- `PATTERN` - The code/pattern content
- `GENERATED` - ISO timestamp

## Extending

To add new sample types, edit `sample-generator.sh` directly. Add new
`generate_<domain>_samples()` functions and register them in the `case` dispatch.
