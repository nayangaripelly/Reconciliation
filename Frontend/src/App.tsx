import { useMemo, useState } from "react";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;
type ResultRow = Record<string, unknown>;

type ReconciliationResponse = {
  duplicates: ResultRow[];
  timing_gaps: ResultRow[];
  ghost_refunds: ResultRow[];
  rounding_errors: ResultRow[];
};

const REQUIRED_FILES = [
  {
    key: "internal_file" as const,
    label: "Internal Transactions CSV",
    expected: "internal_transactions.csv",
  },
  {
    key: "bank_file" as const,
    label: "Bank Settlements CSV",
    expected: "bank_settlements.csv",
  },
  {
    key: "recon_file" as const,
    label: "Recon Log CSV",
    expected: "recon_log.csv",
  },
];

type UploadState = {
  internal_file: File | null;
  bank_file: File | null;
  recon_file: File | null;
};

const INITIAL_RESULTS: ReconciliationResponse = {
  duplicates: [],
  timing_gaps: [],
  ghost_refunds: [],
  rounding_errors: [],
};

function ResultsTable({ title, rows }: { title: string; rows: ResultRow[] }) {
  const columns = useMemo(() => {
    if (!rows.length) {
      return [];
    }
    return Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  }, [rows]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {!rows.length ? (
        <p className="text-sm text-slate-500">No issues found in this category.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="whitespace-nowrap px-3 py-2 font-medium uppercase tracking-wide text-slate-600"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-slate-50">
                  {columns.map((column) => (
                    <td key={`${rowIndex}-${column}`} className="whitespace-nowrap px-3 py-2 text-slate-700">
                      {String(row[column] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function App() {
  const [files, setFiles] = useState<UploadState>({
    internal_file: null,
    bank_file: null,
    recon_file: null,
  });
  const [results, setResults] = useState<ReconciliationResponse>(INITIAL_RESULTS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allFilesSelected = REQUIRED_FILES.every(({ key }) => files[key]);

  const handleFileChange = (key: keyof UploadState, file: File | null) => {
    setFiles((previous) => ({ ...previous, [key]: file }));
  };

  const runReconciliation = async () => {
    if (!allFilesSelected) {
      setError("Please upload all three CSV files before running reconciliation.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(INITIAL_RESULTS);

    const formData = new FormData();
    formData.append("internal_file", files.internal_file as Blob);
    formData.append("bank_file", files.bank_file as Blob);
    formData.append("recon_file", files.recon_file as Blob);

    try {
      const response = await fetch(BACKEND_URL as string, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const data: ReconciliationResponse = await response.json();
      setResults({
        duplicates: data.duplicates ?? [],
        timing_gaps: data.timing_gaps ?? [],
        ghost_refunds: data.ghost_refunds ?? [],
        rounding_errors: data.rounding_errors ?? [],
      });
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Unknown error occurred while uploading files.";
      setError(`Failed to run reconciliation: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header>
          <h1 className="text-3xl font-bold text-slate-900">Reconciliation Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">Upload all CSV files, then run reconciliation against the backend API.</p>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">Upload Files</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {REQUIRED_FILES.map(({ key, label, expected }) => (
              <label
                key={key}
                className="cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 transition hover:border-indigo-400 hover:bg-indigo-50"
              >
                <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
                <div className="mb-3 text-xs text-slate-500">Expected: {expected}</div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => handleFileChange(key, event.target.files?.[0] ?? null)}
                />
                <div className="rounded-md bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                  {files[key]?.name ?? "Click to choose CSV"}
                </div>
              </label>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={runReconciliation}
              disabled={isLoading}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {isLoading && (
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {isLoading ? "Running..." : "Run Reconciliation"}
            </button>
            {!allFilesSelected && <span className="text-xs text-amber-600">All three files are required.</span>}
          </div>

          {error && (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
        </section>

        <ResultsTable title="Duplicates Found" rows={results.duplicates} />
        <ResultsTable title="Timing Gaps (Month-End)" rows={results.timing_gaps} />
        <ResultsTable title="Ghost Refunds (Missing Internal)" rows={results.ghost_refunds} />
        <ResultsTable title="Rounding Differences" rows={results.rounding_errors} />
      </div>
    </main>
  );
}

export default App;
