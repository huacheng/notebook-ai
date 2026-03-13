#!/usr/bin/env python3
import json
import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description="Extract values from JSON file")
    parser.add_argument("file", help="Path to JSON file")
    parser.add_argument("key", help="Key to extract")
    parser.add_argument("--join", action="store_true", help="Join list values with newlines")
    args = parser.parse_args()

    try:
        with open(args.file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading JSON: {e}", file=sys.stderr)
        sys.exit(1)

    val = data.get(args.key, '')
    if args.join and isinstance(val, list):
        print('\n'.join(str(item) for item in val))
    elif val is not None:
        print(val)
    else:
        print('')

if __name__ == "__main__":
    main()
