all: dist

.PHONY: dist clean
dist:
	rm -f tblatex.xpi
	zip -r tblatex.xpi \
		manifest.json \
		icon.png \
		background.js \
		api \
		compose \
		ui \
		README.md \
		Changelog

clean:
	rm -f tblatex.xpi
