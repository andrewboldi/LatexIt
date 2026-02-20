ADDON_ID ?=
OUT ?= tblatex.xpi

all: dist

.PHONY: dist clean
dist:
	./scripts/build_xpi.sh "$(OUT)" "$(ADDON_ID)"

clean:
	rm -f tblatex.xpi
