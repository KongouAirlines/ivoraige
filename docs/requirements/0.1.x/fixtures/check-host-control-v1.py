#!/usr/bin/env python3
"""Validate design examples only. Requires Python jsonschema; runs no host code."""
import json
from pathlib import Path

from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parent.parent
schema = json.loads((root / "schemas/host-control-v1.schema.json").read_text())
cases = json.loads((root / "fixtures/host-control-v1.cases.json").read_text())["cases"]
Draft202012Validator.check_schema(schema)
seen = set()
for case in cases:
    assert case["id"] not in seen, f"duplicate fixture: {case['id']}"
    seen.add(case["id"])
    target = {**schema, "$ref": f"#/$defs/{case['definition']}"}
    errors = list(Draft202012Validator(target).iter_errors(case["instance"]))
    assert bool(errors) != case["valid"], (
        f"{case['id']}: expected valid={case['valid']}; "
        + "; ".join(error.message for error in errors)
    )
    # Producer semantic invariants beyond JSON Schema's cross-field support.
    if case["valid"] and case["definition"] == "Attached":
        value = case["instance"]
        assert value["generation"] == value["state"]["generation"]
        assert value["dataDomainRef"] == value["state"]["dataDomainRef"]

positive = sum(case["valid"] for case in cases)
print(f"PASS: schema and {len(cases)} design fixtures "
      f"({positive} valid, {len(cases) - positive} rejected)")
print("NOT RUN: real host, IPC permissions, OS locks, DSH, crash/restart or Windows PDF tests")
