import type { ReactNode } from "react";

// Ds::Table: a plain data table, a g7 edge and g6 row dividers. `head` holds the column titles, `rows` the cells.
export type TableProps = { head: ReactNode[]; rows: ReactNode[][] };

export function Table({ head, rows }: TableProps) {
  return (
    <div className="ds-table">
      <table>
        <thead>
          <tr>
            {head.map((title, i) => (
              <th key={i}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
