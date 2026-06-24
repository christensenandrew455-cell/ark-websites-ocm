"use client";

import { useState } from "react";

const columns = ["Name", "Phone", "Email", "Address", "Job", "Notes"];

const emptyRow = {
  Name: "",
  Phone: "",
  Email: "",
  Address: "",
  Job: "",
  Notes: "",
};

export default function Page() {
  const [rows, setRows] = useState([{ ...emptyRow }]);

  function addRow() {
    setRows([...rows, { ...emptyRow }]);
  }

  function updateCell(rowIndex, column, value) {
    const updatedRows = [...rows];
    updatedRows[rowIndex] = {
      ...updatedRows[rowIndex],
      [column]: value,
    };
    setRows(updatedRows);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8 text-slate-950">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
              ARK Websites
            </p>
            <h1 className="mt-2 text-4xl font-bold">OCM Dashboard</h1>
          </div>

          <button
            onClick={addRow}
            className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            + Add Row
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="w-20 border border-slate-200 px-4 py-3 text-center">
                    #
                  </th>
                  {columns.map((column) => (
                    <th key={column} className="border border-slate-200 px-4 py-3">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-center font-semibold text-slate-500">
                      {rowIndex + 1}
                    </td>
                    {columns.map((column) => (
                      <td key={column} className="border border-slate-200 p-0">
                        <input
                          value={row[column]}
                          onChange={(e) => updateCell(rowIndex, column, e.target.value)}
                          className="h-12 w-full bg-white px-4 outline-none focus:bg-slate-50"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
