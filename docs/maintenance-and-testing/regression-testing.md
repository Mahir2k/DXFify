# Regression Testing & Quality Verification

This document details automated test suites, quality verification procedures, and regression prevention rules.

---

## 1. Automated Python Regression Test Suite

The Python test suite is located in `dxferpy/test_regression.py`.

- **Scope**: Validates end-to-end computer vision pipeline, homography perspective correction, contour extraction, entity layer assignment, and DXF file generation.
- **Execution Command**:
  ```bash
  cd dxferpy
  venv/bin/python3 -m unittest test_regression.py
  ```

### What `test_regression.py` Validates
1. Loads sample photograph `dxferpy/samples/sample_phone_case.jpg`.
2. Runs `run_pipeline(input_path, output_dir, paper_size='a4')`.
3. Verifies that `result.dxf`, `result.json`, `result.preview.png`, and `result.dbg.png` are produced.
4. Asserts that total extracted entities $> 0$ and layer names match `OUTER`, `HOLES`, and `DETAILS`.
5. Validates that `result.json` contains valid `bboxWidthMm` and `bboxHeightMm` positive floats.

---

## 2. Web Application Build Verification

Before submitting code modifications, verify that React TypeScript compilation succeeds without warnings or errors:

```bash
cd web
npm run build
```

This verifies:
- TypeScript type safety across `App.tsx`, `DxfPreview.tsx`, `Workspace.tsx`, and `coordinateTransforms.ts`.
- Vite asset bundling to `web/dist/`.

---

## 3. Pre-Release Validation Checklist

Before building or releasing a new standalone desktop executable (`dist/dxfify`):

- [ ] All automated Python tests pass: `venv/bin/python3 -m unittest test_regression.py`.
- [ ] React production build completes with 0 errors: `npm run build` in `web/`.
- [ ] Re-compile standalone executable: `venv/bin/pyinstaller --noconfirm ../desktop/dxfify.spec`.
- [ ] Run executable `./dxferpy/dist/dxfify/dxfify` and test uploading a sample image (`samples/sample_phone_case.jpg`).
- [ ] Verify that conversion finishes in <1.5s and real-time logs print to terminal.
