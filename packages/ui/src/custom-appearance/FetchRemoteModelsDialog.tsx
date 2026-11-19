import { useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Search } from "lucide-react";
import type { RemoteProviderModelEntry } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";

export function FetchRemoteModelsDialog({
  open,
  onOpenChange,
  loading,
  saving,
  error,
  endpointUrl,
  models,
  existingModelIds,
  onRetry,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  saving: boolean;
  error: string | null;
  endpointUrl: string | null;
  models: readonly RemoteProviderModelEntry[];
  existingModelIds: ReadonlySet<string>;
  onRetry: () => void;
  onConfirm: (modelIds: readonly string[]) => void | Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const handleOpenChange = (nextOpen: boolean) => {
    if (saving) return;
    if (!nextOpen) {
      setSearchQuery("");
      setSelectedIds(new Set());
    }
    onOpenChange(nextOpen);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return models;
    return models.filter(
      (model) =>
        model.id.toLowerCase().includes(normalizedQuery) ||
        (model.displayName?.toLowerCase().includes(normalizedQuery) ?? false) ||
        (model.ownedBy?.toLowerCase().includes(normalizedQuery) ?? false),
    );
  }, [models, normalizedQuery]);

  const selectableFilteredIds = useMemo(
    () => filteredModels.filter((model) => !existingModelIds.has(model.id)).map((model) => model.id),
    [existingModelIds, filteredModels],
  );

  const allFilteredSelected =
    selectableFilteredIds.length > 0 &&
    selectableFilteredIds.every((modelId) => selectedIds.has(modelId));

  const toggleModel = (modelId: string) => {
    if (existingModelIds.has(modelId) || saving) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    if (saving || selectableFilteredIds.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of selectableFilteredIds) next.delete(id);
      } else {
        for (const id of selectableFilteredIds) next.add(id);
      }
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  const handleConfirm = async () => {
    if (selectedCount === 0 || saving) return;
    const orderedIds = models
      .map((model) => model.id)
      .filter((id) => selectedIds.has(id) && !existingModelIds.has(id));
    if (orderedIds.length === 0) return;
    await onConfirm(orderedIds);
    setSearchQuery("");
    setSelectedIds(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[min(46rem,calc(100vh-4rem))] max-w-xl grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-clip"
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{intl.formatMessage({ id: "settings.modelProvider.fetchModelsTitle" })}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.modelProvider.fetchModelsDescription" })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-foreground-subtlest"
              aria-hidden="true"
            />
            <Input
              {...TECHNICAL_INPUT_ATTRIBUTES}
              type="text"
              size="lg"
              className="pl-8"
              value={searchQuery}
              placeholder={intl.formatMessage({
                id: "settings.modelProvider.fetchModelsSearchPlaceholder",
              })}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-ui-sm text-foreground-subtle">
            <div className="min-w-0 truncate">
              {models.length > 0 ? (
                <span>
                  {intl.formatMessage(
                    { id: "settings.modelProvider.fetchModelsCount" },
                    { count: models.length },
                  )}
                  {endpointUrl ? ` · ${endpointUrl}` : ""}
                </span>
              ) : endpointUrl ? (
                <span className="font-mono">{endpointUrl}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {selectableFilteredIds.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading || saving}
                  onClick={toggleSelectAllFiltered}
                >
                  {intl.formatMessage({
                    id: allFilteredSelected
                      ? "settings.modelProvider.fetchModelsDeselectAll"
                      : "settings.modelProvider.fetchModelsSelectAll",
                  })}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading || saving}
                onClick={onRetry}
              >
                <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
                {intl.formatMessage({ id: "settings.modelProvider.fetchModelsRetry" })}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-48 overflow-y-auto rounded-lg border border-border bg-surface">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-ui-base text-foreground-subtle">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              <span>{intl.formatMessage({ id: "settings.modelProvider.fetchModelsLoading" })}</span>
            </div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 px-4 text-center">
              <p className="max-w-full break-words text-ui-base text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                {intl.formatMessage({ id: "settings.modelProvider.fetchModelsRetry" })}
              </Button>
            </div>
          ) : models.length === 0 ? (
            <div className="flex h-48 items-center justify-center px-4 text-center text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.fetchModelsEmpty" })}
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex h-48 items-center justify-center px-4 text-center text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "settings.modelProvider.fetchModelsNoMatch" })}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredModels.map((model) => {
                const alreadyAdded = existingModelIds.has(model.id);
                const checked = alreadyAdded || selectedIds.has(model.id);
                return (
                  <label
                    key={model.id}
                    className={`flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      alreadyAdded
                        ? "cursor-default opacity-60"
                        : "cursor-pointer hover:bg-hover"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={alreadyAdded || saving}
                      onCheckedChange={() => toggleModel(model.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-ui-base text-foreground">
                          {model.id}
                        </span>
                        {model.displayName ? (
                          <span className="truncate text-ui-sm text-foreground-subtle">
                            {model.displayName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {model.ownedBy ? (
                        <span className="rounded bg-hover px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
                          {model.ownedBy}
                        </span>
                      ) : null}
                      {alreadyAdded ? (
                        <span className="rounded bg-hover px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
                          {intl.formatMessage({
                            id: "settings.modelProvider.fetchModelsAlreadyAdded",
                          })}
                        </span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => handleOpenChange(false)}
          >
            {intl.formatMessage({ id: "settings.modelProvider.cancel" })}
          </Button>
          <Button
            type="button"
            disabled={selectedCount === 0 || saving || loading}
            onClick={() => void handleConfirm()}
          >
            {saving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage(
              { id: "settings.modelProvider.fetchModelsConfirm" },
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
