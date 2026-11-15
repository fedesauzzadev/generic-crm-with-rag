import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useI18n } from "../../app/i18n";

// Tabla genérica del backoffice: React Table (core) + estados de carga, error
// y vacío + paginación server-side. Los botones de paginación los maneja la
// página porque ella conoce el estado (query/page) que también usa el fetch.

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  emptyMessage: string;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  total?: number;
}

export default function DataTable<T>({
  data,
  columns,
  isLoading,
  isError,
  error,
  emptyMessage,
  page,
  totalPages,
  onPageChange,
  total,
}: DataTableProps<T>) {
  const table = useReactTable<T>({ data, columns, getCoreRowModel: getCoreRowModel() });
  const colCount = table.getAllColumns().length;
  const { t } = useI18n();

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-slate-200 bg-slate-50">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-slate-500">
                  {t("common.loading")}
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-red-600">
                  {error instanceof Error ? error.message : t("common.error")}
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {page !== undefined && totalPages !== undefined && onPageChange ? (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <p>{total !== undefined ? t("common.records", { total }) : ""}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-slate-100 disabled:opacity-50"
            >
              {t("common.prevPage")}
            </button>
            <span>{t("common.pageOf", { page, totalPages })}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-slate-100 disabled:opacity-50"
            >
              {t("common.nextPage")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
