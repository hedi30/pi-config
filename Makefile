.PHONY: validate install dry-run export export-dry-run

validate:
	./validate.sh

install:
	./install.sh

dry-run:
	./install.sh --dry-run

export:
	./export.sh

export-dry-run:
	./export.sh --dry-run
