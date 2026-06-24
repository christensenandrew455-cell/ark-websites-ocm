"use client";

import { useState } from "react";

export default function Page() {
  const columns = [
    "Name",
    "Phone",
    "Email",
    "Address",
    "Job",
    "Status",
    "Notes",
  ];

  const emptyRow = {
    Name: "",
    Phone: "",
    Email: "",
    Address: "",
    Job: "",
    Status: "",
    Notes: "",
  };

  const [rows, setRows] = useState([emptyRow]);

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
    <main style={styles.main}>
      <h1 style={styles.title}>ARK Websites OCM</h1>

      <button onClick={addRow} style={styles.button}>
        + Add Row
      </button>

      <div style={styles.sheetWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} style={styles.th}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column} style={styles.td}>
                    <input
                      value={row[column]}
                      onChange={(e) =>
                        updateCell(rowIndex, column, e.target.value)
                      }
                      style={styles.input}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const styles = {
  main: {
    minHeight: "100vh",
    background: "#f4f6f8",
    padding: "30px",
    fontFamily: "Arial, sans-serif",
  },
  title: {
    marginBottom: "20px",
    fontSize: "32px",
  },
  button: {
    padding: "10px 16px",
    border: "none",
    background: "#111",
    color: "white",
    borderRadius: "6px",
    cursor: "pointer",
    marginBottom: "20px",
    fontSize: "15px",
  },
  sheetWrapper: {
    overflowX: "auto",
    background: "white",
    border: "1px solid #ccc",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    minWidth: "900px",
  },
  th: {
    border: "1px solid #ccc",
    background: "#e9ecef",
    padding: "10px",
    textAlign: "left",
    minWidth: "120px",
  },
  td: {
    border: "1px solid #ccc",
    padding: "0",
    height: "40px",
  },
  input: {
    width: "100%",
    height: "100%",
    border: "none",
    padding: "10px",
    fontSize: "14px",
    outline: "none",
    background: "white",
  },
};
