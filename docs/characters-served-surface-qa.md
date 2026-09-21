# Characters served-surface verification

## Scope and verdict

URL: http://127.0.0.1:3001/characters (development server).
Tested desktop 1440×900 / DPR 1 and mobile emulation 390×844 / DPR 2.
The served component is the restored staged SVG implementation, NOT the unfinished Sigma remake. Browser DOM inspection confirmed 95 SVG node buttons and zero canvases. Git diff against the index for CharactersWeb.tsx was empty during verification.

Verdict: baseline surface inspected; replacement visual/performance gate NOT PASSED because it is not integrated. No new production performance claim is supported by this check.

## Observed interactions

- Desktop: clicking Conan's visible node opened the dossier with his name, biography, and 12 threads. Window error/unhandled-rejection instrumentation recorded no errors during this interaction (not a complete console audit).
- Mobile: searching `Conan` produced the named matching result. Selecting it opened the dossier.
- Mobile: closing the dossier and then performing a CDP touch tap on Conan's verified in-viewport node reopened it.
- Repeatable cold-load acceptance test PASSED: touch at (199.17, 458.63) in a 390×844 viewport opened the correct Conan dossier, whose bounds intersected the viewport. No tap-handler edit was made. Saved browser-harness script: `mobile-tap-acceptance.py`; machine result: `mobile-tap-acceptance.json`; screenshot: `mobile-tap-acceptance.png` in the evidence directory below.
- Mobile: no document-level horizontal overflow was detected.

## Visual findings

- Desktop: central protagonist is easy to locate, but many saturated threads compete with names. Labels overlap in the police cluster near Megure and Shiratori. Outer nodes and labels are clipped by the initial zoom.
- Mobile: the cold-load view centers Conan, but shows only a slice of the network. Police-cluster names overlap severely; edge paths cross text and some outer labels are clipped.
- Mobile dossier: title and close button are visible. Search controls disappear while it is open; the zoom dock moves above the sheet. Biography/threads are not visible at the initial peek height; expansion and scrolling were not tested.

## Harness limitations

An earlier mobile attempt produced huge off-screen node coordinates after invalid/stale synthetic input. Discard that attempt as evidence of normal mobile interaction. Reloading and checking coordinates before dispatch restored a visible centered map and enabled the successful touch test. The cause of that earlier state is unresolved.

Not tested here: physical phones, Safari, pinch, sustained drag performance, theme switching, full keyboard navigation, sheet snap/scroll, all nodes, lifecycle leaks, or the proposed WebGL replacement. This pass does not replace a production benchmark.

## Evidence files

Directory: /home/sigmund/.hermes/cache/browser-use/workspace/20260917_232948_c6b281/

- gate-desktop.png — desktop overview
- gate-desktop-selected.png — desktop selection capture
- final-mobile.png — mobile cold-load overview
- final-mobile-search-dossier.png — mobile dossier opened from search

Other `gate-mobile*` captures include discarded attempts; do not use them as normal-state acceptance evidence.

## Remaining repository state

CharactersWeb.tsx is restored to the staged original. Experimental package.json/package-lock.json changes and new graph-engine/test files remain outside that component. They are not a completed replacement. No commit or push was performed.
