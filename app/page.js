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
  isEditing: true,
};

export default function Page() {
  const [rows, setRows] = useState([{ ...emptyRow }]);
  const [search, setSearch] = useState("");

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

  function saveRow(rowIndex) {
    const updatedRows = [...rows];
    updatedRows[rowIndex] = {
      ...updatedRows[rowIndex],
      isEditing: false,
    };
    setRows(updatedRows);
  }

  function editRow(rowIndex) {
    const updatedRows = [...rows];
    updatedRows[rowIndex] = {
      ...updatedRows[rowIndex],
      isEditing: true,
    };
    setRows(updatedRows);
  }

  const filteredRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      const searchText = search.trim().toLowerCase();

      if (!searchText) {
        return true;
      }

      return columns.some((column) =>
        String(row[column]).toLowerCase().includes(searchText)
      );
    });

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
            + Add New
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, job, address, or notes..."
            className="h-12 w-full rounded-lg border border-slate-300 px-4 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
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
                  <th className="w-32 border border-slate-200 px-4 py-3 text-center">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.map(({ row, originalIndex }) => (
                  <tr key={originalIndex}>
                    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-center font-semibold text-slate-500">
                      {originalIndex + 1}
                    </td>
                    {columns.map((column) => (
                      <td key={column} className="border border-slate-200 p-0">
                        <input
                          value={row[column]}
                          disabled={!row.isEditing}
                          onChange={(e) =>
                            updateCell(originalIndex, column, e.target.value)
                          }
                          className="h-12 w-full bg-white px-4 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-700 focus:bg-slate-50"
                        />
                      </td>
                    ))}
                    <td className="border border-slate-200 px-3 py-2 text-center">
                      {row.isEditing ? (
                        <button
                          onClick={() => saveRow(originalIndex)}
                          className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700"
                        >
                          Save
                        </button>
                      ) : (
                        <button
                          onClick={() => editRow(originalIndex)}
                          className="rounded-md bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + 2}
                      className="border border-slate-200 px-4 py-8 text-center text-slate-500"
                    >
                      No matching rows found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
