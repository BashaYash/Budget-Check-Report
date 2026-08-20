sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Popover",
    "sap/m/VBox",
    "sap/m/ObjectStatus",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/m/Token"
], (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, Popover, VBox, ObjectStatus, SelectDialog, StandardListItem, Token) => {
    "use strict";

    // Single source of truth for every table/chart column: which OData property it
    // reads from, its display label and order, and its type:
    const TABLE_FIELDS = [
        { key: "costCenter", label: "Cost Center", sourceField: "CostCenter", type: "text" },
        { key: "costCenterText", label: "Cost Center Description", sourceField: "CostCenter_Text", type: "text" },
        { key: "companyCode", label: "Company Code", sourceField: "CompanyCode", type: "text" },
        { key: "companyName", label: "Company Code Description", sourceField: "CompanyName", type: "text" },
        { key: "department", label: "Department Code", sourceField: "Department", type: "text" },
        { key: "currency", label: "Currency", sourceField: "Currency", type: "text" },
        { key: "availableBudget", label: "Available Budget", sourceField: "AvailableBuget", type: "header", color: "#7CB92C" },
        { key: "totalApprovedBudget", label: "Total Approved Budget", sourceField: "TotalBudget", type: "header", color: "#4EA7F2" },
        { key: "ccBudget", label: "C.C Budget", sourceField: "CcBudget", type: "header", color: "#E07B00" },
        { key: "ioBudget", label: "IO Budget", sourceField: "IoBudget", type: "header", color: "#8B5CF6" },
        { key: "prCommitStock", label: "PR Commitment Stock Item", sourceField: "PrCommitStockItem", type: "line", color: "#17A398" },
        { key: "prAsset", label: "PR Asset", sourceField: "PrAsset", type: "line", color: "#2B6FDE" },
        { key: "prCommitNonStock", label: "PR Commitment Non Stock Item", sourceField: "PrCommNonStockItem", type: "line", color: "#D6249F" },
        { key: "poNonStock", label: "Total PO Non stock Item", sourceField: "TotalPONonStockItem", type: "line", color: "#6B7280" },
        { key: "poStock", label: "Total PO stock Item", sourceField: "TotalPoStockItem", type: "line", color: "#E06666" },
        { key: "poAsset", label: "PO Asset", sourceField: "PoAsset", type: "line", color: "#6F63E0" },
        { key: "actualConsumption", label: "Actual Consumption", sourceField: "ActualConsumption", type: "line", color: "#1E3A8A" },
        { key: "ioConsumption", label: "IO Consumption", sourceField: "IoConsump", type: "line", color: "#B45309" }
    ];

    return Controller.extend("com.onex.budgetcheck.controller.Home", {

        onInit() {
            // Empty model up front so the VizFrames have nothing to render until Submit
            this.getView().setModel(new JSONModel({
                chartData: [],
                barData: [],
                tableRows: [],
                totalRows: [],
                hasData: false,
                summary: {}
            }), "chartModel");
        },

        onSubmit() {
            const oView = this.getView();

            const aCompanyCodes = this._getMultiInputValues(oView.byId("companyCodeInput"));
            const aCostCenters = this._getMultiInputValues(oView.byId("costCenterInput"));
            const sDepartment = oView.byId("departmentInput").getValue().trim();

            if (!aCompanyCodes.length || !aCostCenters.length) {
                MessageToast.show("Please select at least one Company Code and at least one Cost Center.");
                return;
            }

            const sCompanyFilter = this._buildOrFilter("CompanyCode", aCompanyCodes);
            const sCostCenterFilter = this._buildOrFilter("CostCenter", aCostCenters);

            // Department is optional - only add its clause when the user entered one.
            const aFilterParts = [sCompanyFilter, sCostCenterFilter];
            if (sDepartment) {
                aFilterParts.push("(Department eq '" + this._escapeODataString(sDepartment) + "')");
            }

            const sFilter = aFilterParts.join(" and ");

            const sUrl = this._getServiceUrl() + "BudgetCheckSet" +
                "?$filter=" + encodeURIComponent(sFilter) +
                "&$format=json";

            oView.setBusy(true);

            jQuery.ajax({
                url: sUrl,
                type: "GET",
                dataType: "json",
                success: (oData) => {
                    oView.setBusy(false);
                    const aResults = oData && oData.d && oData.d.results;

                    if (!aResults || !aResults.length) {
                        MessageToast.show("No budget data found for the given inputs.");
                        oView.getModel("chartModel").setData({
                            chartData: [], barData: [], tableRows: [], totalRows: [], hasData: false, summary: {}
                        });
                        return;
                    }

                    this._updateChart(aResults);
                },
                error: () => {
                    oView.setBusy(false);
                    MessageBox.error("Failed to fetch budget data. Please check your inputs and try again.");
                }
            });
        },

        _getServiceUrl() {
            return this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/mainService/uri");
        },

        // Reads the tokens off a MultiInput and returns their key (falling back to
        // the token text if no key was set)
        _getMultiInputValues(oMultiInput) {
            return oMultiInput.getTokens().map((oToken) => oToken.getKey() || oToken.getText());
        },

        // Builds an OData OR-group for one field, e.g.
        // (CompanyCode eq '3120' or CompanyCode eq '2000')
        _buildOrFilter(sField, aValues) {
            return "(" + aValues.map((sValue) => sField + " eq '" + this._escapeODataString(sValue) + "'").join(" or ") + ")";
        },

        _escapeODataString(sValue) {
            return String(sValue).replace(/'/g, "''");
        },

        _updateChart(aResults) {
            this._aLastResults = aResults;

            // See the "header" type note above TABLE_FIELDS: header figures repeat
            // per row within a CompanyCode+CostCenter group, so they're summed once
            // per unique group here, not once per row.
            const oHeaderGroupsSeen = {};
            const aHeaderGroups = [];
            aResults.forEach((oRow) => {
                const sGroupKey = (oRow.CompanyCode || "") + "|" + (oRow.CostCenter || "");
                if (!oHeaderGroupsSeen[sGroupKey]) {
                    oHeaderGroupsSeen[sGroupKey] = true;
                    aHeaderGroups.push(oRow);
                }
            });

            // One row per PR/PO line item, exactly as returned by the service -
            // every column (Cost Center, descriptions, budgets, consumption, ...)
            // comes straight from OData.
            const aTableRows = aResults.map((oRow) => {
                const oRowData = { isTotal: false };
                TABLE_FIELDS.forEach((oField) => {
                    oRowData[oField.key] = oField.type === "text"
                        ? (oRow[oField.sourceField] || "")
                        : (parseFloat(oRow[oField.sourceField]) || 0);
                });
                return oRowData;
            });

            // Column sums - the SINGLE source used for the Total table row AND the
            // Pie / Bar charts, so the charts always reflect true totals across
            // every selected Company Code / Cost Center, never just one line item.
            const oColumnSums = {};
            TABLE_FIELDS.forEach((oField) => {
                if (oField.type === "text") {
                    return;
                }
                oColumnSums[oField.key] = oField.type === "header"
                    ? aHeaderGroups.reduce((fSum, oRow) => fSum + (parseFloat(oRow[oField.sourceField]) || 0), 0)
                    : aTableRows.reduce((fSum, oRow) => fSum + oRow[oField.key], 0);
            });

            // Total row: identity (text) columns can't be meaningfully summed once
            // several Cost Centers/Company Codes are in the result set, so they
            // stay blank - the first column just carries the word "Total".
            const oTotalRow = { isTotal: true };
            TABLE_FIELDS.forEach((oField, iIndex) => {
                if (oField.type === "text") {
                    oTotalRow[oField.key] = iIndex === 0 ? "Total" : "";
                } else {
                    oTotalRow[oField.key] = oColumnSums[oField.key];
                }
            });

            // Combined categories for the Pie / Bar / custom legend - one slice/bar
            // per amount field (identity columns excluded), always driven by the
            // Total row sums above.
            const aChartData = TABLE_FIELDS.filter((oField) => oField.type !== "text").map((oField) => ({
                Category: oField.label,
                Value: oColumnSums[oField.key],
                Color: oField.color
            }));

            this.getView().getModel("chartModel").setData({
                chartData: aChartData,           // feeds the pie + custom legend (sum totals)
                barData: aChartData,             // feeds the bar - same sum totals, shown side by side
                tableRows: aTableRows,           // feeds the scrolling body: one row per line item
                totalRows: [oTotalRow],          // feeds the pinned Total row table
                hasData: true,
                summary: {
                    totalBudget: oColumnSums.totalApprovedBudget,
                    availableBudget: oColumnSums.availableBudget,
                    currency: aHeaderGroups[0].Currency,
                    costCenter: aHeaderGroups.map((oRow) => oRow.CostCenter).join(", "),
                    company: aHeaderGroups.map((oRow) => oRow.CompanyCode).join(", ")
                }
            });
        },

        onSliceSelect(oEvent) {
            const aData = oEvent.getParameter("data");
            if (!aData || !aData.length) {
                return;
            }
            const oPoint = aData[0].data;
            this._showDetailPopover(oPoint["Budget Type"] || oPoint["Item"], oPoint["Amount"], oEvent.getSource());
        },

        onBarSelect(oEvent) {
            const aData = oEvent.getParameter("data");
            if (!aData || !aData.length) {
                return;
            }
            const oPoint = aData[0].data;
            this._showDetailPopover(oPoint["Budget Type"] || oPoint["Item"], oPoint["Amount"], oEvent.getSource());
        },

        // Line items list below the charts - kept as a click handler for
        // touch/keyboard use. Hover is wired up separately below.
        onLineItemPress(oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("chartModel");
            if (!oCtx) {
                return;
            }
            const oItem = oCtx.getObject();
            this._showDetailPopover(oItem.Category, oItem.Value, oEvent.getSource());
        },

        // Fires whenever the Budget Type list (re)renders its items. Attaches
        // native mouseenter/mouseleave handlers to each row so the same detail
        // popover opens on hover, not just on click.
        onListUpdateFinished(oEvent) {
            const oList = oEvent.getSource();
            const $items = oList.$().find(".sapMLIB");

            $items.off("mouseenter.budgetHover mouseleave.budgetHover");

            $items.on("mouseenter.budgetHover", (oDomEvent) => {
                const oControl = sap.ui.getCore().byId(oDomEvent.currentTarget.id);
                if (!oControl) {
                    return;
                }
                const oCtx = oControl.getBindingContext("chartModel");
                if (!oCtx) {
                    return;
                }
                const oItem = oCtx.getObject();
                this._showDetailPopover(oItem.Category, oItem.Value, oControl);
            });

            $items.on("mouseleave.budgetHover", () => {
                if (this._oDetailPopover && this._oDetailPopover.isOpen()) {
                    this._oDetailPopover.close();
                }
            });
        },

        _showDetailPopover(sCategory, fValue, oOpenerControl) {
            if (fValue === undefined || fValue === null) {
                return;
            }
            const sCurrency = this._aLastResults ? this._aLastResults[0].Currency : "";

            if (!this._oDetailPopover) {
                this._oDetailPopover = new Popover({
                    title: "Details",
                    placement: "Top",
                    content: [
                        new VBox({
                            class: "sapUiMediumMargin",
                            items: [
                                new ObjectStatus({ title: "Category", text: "{detail>/category}" }),
                                new ObjectStatus({ title: "Amount", text: "{detail>/amount}" })
                            ]
                        })
                    ]
                });
                this.getView().addDependent(this._oDetailPopover);
            }

            this._oDetailPopover.setModel(new JSONModel({
                category: sCategory,
                amount: fValue.toLocaleString(undefined, { minimumFractionDigits: 2 }) + " " + sCurrency
            }), "detail");

            this._oDetailPopover.openBy(oOpenerControl);
        },


        // F4 value help - Company Code and Cost Center are multi-select (tokens).
        // Cost Center's list is narrowed by whichever Company Code(s) are
        // selected. Department is single-select and unfiltered (see below).

        onCompanyCodeValueHelp() {
            const sUrl = this._getServiceUrl() + "CompanyCodeSHSet";
            this._openValueHelpDialog("Company Code", sUrl, true, (aSelectedRows) => {
                this._addTokensToMultiInput(this.byId("companyCodeInput"), aSelectedRows, "CompanyCode");
            });
        },

        onCostCenterValueHelp() {
            const aCompanyCodes = this._getMultiInputValues(this.byId("companyCodeInput"));
            // The Cost Center search help entity is BudgetCostcenterSHSet, and
            // unlike BudgetCheckSet its Company Code field is "Companycode"
            // (lowercase c), not "CompanyCode" - confirmed via Gateway Client.
            let sUrl = this._getServiceUrl() + "BudgetCostcenterSHSet";
            if (aCompanyCodes.length) {
                sUrl += "?$filter=" + encodeURIComponent(this._buildOrFilter("Companycode", aCompanyCodes));
            }
            this._openValueHelpDialog("Cost Center", sUrl, true, (aSelectedRows) => {
                // "Costcenter" (lowercase c) is this entity's field name too.
                this._addTokensToMultiInput(this.byId("costCenterInput"), aSelectedRows, "Costcenter");
            }, {
                // Per request: the dialog list highlights "Budget Cost Center"
                // (Budgetcarryingcostcenter) as the title, with its name
                // (Budgetcostcentername) as the description underneath. This only
                // changes what's *shown* in the picker - the value actually
                // stored as a token/used in the filter is still "Costcenter".
                titleField: "Budgetcarryingcostcenter",
                descriptionFields: ["Budgetcostcentername"]
            });
        },

        onDepartmentValueHelp() {
            // DepartmentSHSet has no Company Code field at all - confirmed via
            // Gateway Client, its fields are Departmentid / Departmentname /
            // Plant / Plantname. With Plant removed from the UI there's nothing
            // left to filter it by, so it's loaded unfiltered.
            const sUrl = this._getServiceUrl() + "DepartmentSHSet";
            this._openValueHelpDialog("Department", sUrl, false, (oSelectedRow) => {
                const aKeys = Object.keys(oSelectedRow).filter((k) => k !== "__metadata");
                const sKeyField = aKeys.find((k) => k.toLowerCase() === "departmentid") || aKeys[0];
                this.byId("departmentInput").setValue(oSelectedRow[sKeyField]);
            });
        },

        // Turns confirmed SelectDialog rows into Tokens on a MultiInput,
        // skipping any value that's already present as a token.
        _addTokensToMultiInput(oMultiInput, aSelectedRows, sPreferredKeyField) {
            aSelectedRows.forEach((oRow) => {
                const aKeys = Object.keys(oRow).filter((k) => k !== "__metadata");
                const sKeyField = aKeys.find((k) => k.toLowerCase() === sPreferredKeyField.toLowerCase()) || aKeys[0];
                const sValue = oRow[sKeyField];

                const bExists = oMultiInput.getTokens().some((oToken) => oToken.getKey() === sValue);
                if (!bExists) {
                    oMultiInput.addToken(new Token({ key: sValue, text: sValue }));
                }
            });
        },

        // Generic F4 help: reads sUrl, shows the results in a searchable
        // SelectDialog (single or multi select), and calls fnOnConfirm with either
        _openValueHelpDialog(sTitle, sUrl, bMultiSelect, fnOnConfirm, oDisplayFields) {
            const sReadUrl = sUrl + (sUrl.indexOf("?") > -1 ? "&" : "?") + "$format=json";

            this.getView().setBusy(true);

            jQuery.ajax({
                url: sReadUrl,
                type: "GET",
                dataType: "json",
                success: (oData) => {
                    this.getView().setBusy(false);
                    const oD = oData && oData.d;
                    let aList = [];

                    if (oD) {
                        if (Array.isArray(oD.results)) {
                            aList = oD.results;
                        } else if (Array.isArray(oD.Results)) {
                            aList = oD.Results;
                        } else if (Array.isArray(oD)) {
                            aList = oD;
                        } else {
                            aList = [oD];
                        }
                    }

                    if (!aList.length) {
                        MessageToast.show("No values found.");
                        return;
                    }

                    this._showSelectDialog(sTitle, aList, bMultiSelect, fnOnConfirm, oDisplayFields);
                },
                error: () => {
                    this.getView().setBusy(false);
                    MessageBox.error("Failed to load value help data for " + sTitle + ".");
                }
            });
        },

        _showSelectDialog(sTitle, aList, bMultiSelect, fnOnConfirm, oDisplayFields) {
            const aKeys = Object.keys(aList[0]).filter((k) => k !== "__metadata");
            const sKeyField = (oDisplayFields && oDisplayFields.titleField) || aKeys[0];
            const aDescFields = (oDisplayFields && oDisplayFields.descriptionFields) || aKeys.slice(1, 3);

            // Multi-select and single-select need different `multiSelect` settings
            // and different confirm-event handling, so two dialog instances are
            // kept (one per mode) rather than reconfiguring one dialog on the fly.
            const sDialogRef = bMultiSelect ? "_oValueHelpDialogMulti" : "_oValueHelpDialogSingle";

            if (!this[sDialogRef]) {
                this[sDialogRef] = new SelectDialog({
                    multiSelect: bMultiSelect,
                    confirm: (oEvent) => {
                        if (bMultiSelect) {
                            const aSelectedContexts = oEvent.getParameter("selectedContexts") || [];
                            this._fnValueHelpConfirm(aSelectedContexts.map((oCtx) => oCtx.getObject()));
                        } else {
                            const oSelectedItem = oEvent.getParameter("selectedItem");
                            const oCtx = oSelectedItem && oSelectedItem.getBindingContext("vh");
                            if (oCtx) {
                                this._fnValueHelpConfirm(oCtx.getObject());
                            }
                        }
                    },
                    search: (oEvent) => {
                        const sValue = oEvent.getParameter("value");
                        const oBinding = this[sDialogRef].getBinding("items");
                        if (!oBinding) {
                            return;
                        }
                        oBinding.filter(sValue ? [
                            new Filter({
                                filters: this._aValueHelpKeys.map((k) => new Filter(k, FilterOperator.Contains, sValue)),
                                and: false
                            })
                        ] : []);
                    }
                });
                this.getView().addDependent(this[sDialogRef]);
            }

            this._aValueHelpKeys = aKeys;
            this._fnValueHelpConfirm = fnOnConfirm;

            this[sDialogRef].setTitle(sTitle);
            this[sDialogRef].setModel(new JSONModel(aList), "vh");
            this[sDialogRef].unbindAggregation("items");
            this[sDialogRef].bindAggregation("items", {
                path: "vh>/",
                template: new StandardListItem({
                    title: "{vh>" + sKeyField + "}",
                    description: aDescFields.map((f) => "{vh>" + f + "}").join(" - ")
                })
            });
            this[sDialogRef].open();
        }

    });
});