ADDON_ID ?=
OUT ?= tblatex.xpi

HELPER_SRC = helper/tblatex_helper.py
HELPER_DEST = $(HOME)/.local/share/tblatex-helper/tblatex_helper.py
XPI_DEST = $(HOME)/.thunderbird/zbm35iiu.default-default/extensions/tblatex@andrewboldi.dev.xpi

all: dist

.PHONY: dist clean install
dist:
	./scripts/build_xpi.sh "$(OUT)" "$(ADDON_ID)"

install: dist
	cp "$(OUT)" "$(XPI_DEST)"
	cp "$(HELPER_SRC)" "$(HELPER_DEST)"
	systemctl --user restart tblatex-helper.service || systemctl --user start tblatex-helper.service

clean:
	rm -f tblatex.xpi
