#!/usr/bin/env bash
# Step 1: clear the previous run's local state.
rm -f "$OF1_STATE_DIR"/of1-*-status.json
rm -f "$OF1_STATE_DIR/discovery.html"
# Staged DA inputs + hub inputs from the previous run — otherwise a re-run
# could re-upload stale landing copy / personas / chips / knowledge pages.
rm -f "$OF1_STATE_DIR"/{of1-landing.json,personas-rows.json,suggestions-rows.json,knowledge-pages.json,brand-voice.html}
rm -rf "$OF1_STATE_DIR/hub"
rm -f "$OF1_STATE_DIR/product-urls.txt"
