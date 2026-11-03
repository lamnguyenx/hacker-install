.PHONY: install-e

# Editable global install: registers this checkout with `bun link` and points
# the `hi` binary at src/index.ts, so source edits take effect immediately.
install-e:
	bun install
	mkdir -p dist/npm
	printf '#!/usr/bin/env bun\nimport "../../src/index.ts";\n' > dist/npm/index.js
	chmod +x dist/npm/index.js
	bun link
