from io import StringIO
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Reconciliation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://reconciliation-pi.vercel.app/","http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_csv(upload: UploadFile) -> pd.DataFrame:
    raw = upload.file.read()
    if not raw:
        return pd.DataFrame()

    text = raw.decode("utf-8").strip()
    if not text:
        return pd.DataFrame()

    return pd.read_csv(StringIO(text))


def _ensure_columns(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for column in columns:
        if column not in frame.columns:
            frame[column] = pd.NA
    return frame


def _to_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    cleaned = frame.where(pd.notna(frame), None)
    return cleaned.to_dict(orient="records")


@app.post("/reconcile")
async def reconcile(
    internal_file: UploadFile = File(...),
    bank_file: UploadFile = File(...),
    recon_file: UploadFile = File(...),
) -> dict[str, list[dict[str, Any]]]:
    try:
        internal_df = _read_csv(internal_file)
        bank_df = _read_csv(bank_file)
        _ = _read_csv(recon_file)
    except Exception as error:  # pragma: no cover - protective branch
        raise HTTPException(status_code=400, detail=f"Invalid CSV upload: {error}") from error

    internal_df = _ensure_columns(
        internal_df,
        [
            "transaction_id",
            "order_id",
            "amount",
            "currency",
            "status",
            "bank_ref_id",
            "processing_fee",
            "created_at",
            "updated_at",
        ],
    )
    bank_df = _ensure_columns(
        bank_df,
        ["bank_entry_id", "external_ref_id", "amount", "posting_date", "value_date", "batch_id"],
    )

    # Cast join keys to string to avoid type mismatch issues.
    internal_df["bank_ref_id"] = internal_df["bank_ref_id"].astype(str)
    bank_df["external_ref_id"] = bank_df["external_ref_id"].astype(str)
    internal_df["transaction_id"] = internal_df["transaction_id"].astype(str)
    bank_df["bank_entry_id"] = bank_df["bank_entry_id"].astype(str)

    internal_duplicates = internal_df[internal_df["transaction_id"].duplicated(keep=False)]
    bank_duplicates = bank_df[
        bank_df["bank_entry_id"].duplicated(keep=False) | bank_df["external_ref_id"].duplicated(keep=False)
    ]
    duplicates = pd.concat([internal_duplicates, bank_duplicates], ignore_index=True, sort=False)

    left_join = internal_df.merge(
        bank_df,
        how="left",
        left_on="bank_ref_id",
        right_on="external_ref_id",
        suffixes=("_internal", "_bank"),
    )
    timing_gaps = left_join[
        left_join["external_ref_id"].isna() & left_join["status"].astype(str).str.upper().eq("SUCCESS")
    ]

    right_join = internal_df.merge(
        bank_df,
        how="right",
        left_on="bank_ref_id",
        right_on="external_ref_id",
        suffixes=("_internal", "_bank"),
    )
    bank_amount_numeric = pd.to_numeric(right_join["amount_bank"], errors="coerce")
    ghost_refunds = right_join[right_join["transaction_id"].isna() | (bank_amount_numeric < 0)]

    matched = internal_df.merge(
        bank_df,
        how="inner",
        left_on="bank_ref_id",
        right_on="external_ref_id",
        suffixes=("_internal", "_bank"),
    )
    internal_amount_numeric = pd.to_numeric(matched["amount_internal"], errors="coerce")
    bank_amount_matched = pd.to_numeric(matched["amount_bank"], errors="coerce")
    matched["expected_net"] = internal_amount_numeric - (internal_amount_numeric * 0.005)
    matched["difference"] = (matched["expected_net"] - bank_amount_matched).abs()
    rounding_errors = matched[(matched["difference"] > 0.00) & (matched["difference"] < 0.05)]

    return {
        "duplicates": _to_records(duplicates),
        "timing_gaps": _to_records(timing_gaps),
        "ghost_refunds": _to_records(ghost_refunds),
        "rounding_errors": _to_records(rounding_errors),
    }
