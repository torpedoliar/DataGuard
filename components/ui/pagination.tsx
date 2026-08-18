"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
    /** Base path the page links are built on (e.g. "/report"). Defaults to "/report". */
    basePath?: string;
}

export default function Pagination({
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    basePath = "/report",
}: PaginationProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const getPageUrl = (page: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("page", String(page));
        return `${basePath}?${params.toString()}`;
    };

    const handlePageChange = (page: number) => {
        if (page < 1 || page > totalPages) return;
        router.push(getPageUrl(page));
    };

    const startItem = (currentPage - 1) * pageSize + 1;
    const endItem = Math.min(currentPage * pageSize, totalItems);

    // Generate page numbers to display
    const getPageNumbers = () => {
        const pages: (number | string)[] = [];
        const showPages = 5;

        if (totalPages <= showPages) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            if (currentPage <= 3) {
                for (let i = 1; i <= 5; i++) pages.push(i);
                pages.push("...");
                pages.push(totalPages);
            } else if (currentPage >= totalPages - 2) {
                pages.push(1);
                pages.push("...");
                for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push("...");
                for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
                pages.push("...");
                pages.push(totalPages);
            }
        }

        return pages;
    };

    if (totalPages <= 1) return null;

    const controlClass =
        "p-2 rounded-lg border border-ops-border text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ops-muted";

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-ops-border">
            {/* Info */}
            <div className="text-sm text-ops-muted">
                Showing <span className="font-medium text-ops-text">{startItem}</span> to{" "}
                <span className="font-medium text-ops-text">{endItem}</span> of{" "}
                <span className="font-medium text-ops-text">{totalItems}</span> results
            </div>

            {/* Pagination Controls */}
            <nav aria-label="Pagination" className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    aria-label="First page"
                    title="First page"
                    className={controlClass}
                >
                    <ChevronsLeft className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                    title="Previous page"
                    className={controlClass}
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1">
                    {getPageNumbers().map((page, index) =>
                        typeof page === "number" ? (
                            <button
                                key={index}
                                type="button"
                                onClick={() => handlePageChange(page)}
                                aria-current={page === currentPage ? "page" : undefined}
                                aria-label={`Page ${page}`}
                                className={`min-w-[40px] h-10 rounded-lg border text-sm font-medium transition-colors ${
                                    page === currentPage
                                        ? "bg-ops-accent border-ops-accent text-slate-950"
                                        : "border-ops-border text-ops-text hover:bg-ops-surface-raised"
                                }`}
                            >
                                {page}
                            </button>
                        ) : (
                            <span
                                key={index}
                                aria-hidden="true"
                                className="px-2 text-ops-muted"
                            >
                                {page}
                            </span>
                        )
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    aria-label="Next page"
                    title="Next page"
                    className={controlClass}
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    aria-label="Last page"
                    title="Last page"
                    className={controlClass}
                >
                    <ChevronsRight className="h-4 w-4" />
                </button>
            </nav>
        </div>
    );
}