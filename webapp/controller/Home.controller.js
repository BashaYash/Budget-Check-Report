sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    return Controller.extend("com.onex.budgetcheck.controller.Home", {

        onInit() {
            // Empty model up front so the VizFrame has nothing to render until Submit
            this.getView().setModel(new JSONModel({ chartData: [], hasData: false }), "chartModel");
        },

        onSubmit() {
            const oView = this.getView();

            const sCompanyCode = oView.byId("companyCodeInput").getValue().trim();
            const sCostCenter  = oView.byId("costCenterInput").getValue().trim();
            const sPlant       = oView.byId("plantInput").getValue().trim();
            const sDepartment  = oView.byId("departmentInput").getValue().trim();

            if (!sCompanyCode || !sCostCenter || !sPlant || !sDepartment) {
                MessageToast.show("Please fill in all fields.");
                return;
            }

            const sFilter = "(CompanyCode eq '" + sCompanyCode + "')" +
                            " and (Plant eq '" + sPlant + "')" +
                            " and (CostCenter eq '" + sCostCenter + "')" +
                            " and (Department eq '" + sDepartment + "')";

            const sUrl = "/sap/opu/odata/sap/ZMM_BUDGET_CHECK_REPORT_SRV/BudgetCheckSet" +
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
                        oView.getModel("chartModel").setData({ chartData: [], hasData: false });
                        return;
                    }

                    this._updateChart(aResults[0]);
                },
                error: () => {
                    oView.setBusy(false);
                    MessageBox.error("Failed to fetch budget data. Please check your inputs and try again.");
                }
            });
        },

        _updateChart(oBudget) {
            const aChartData = [
                { Category: "CC Budget",             Value: parseFloat(oBudget.CcBudget) || 0 },
                { Category: "IO Budget",             Value: parseFloat(oBudget.IoBudget) || 0 },
                { Category: "PR Commit (Stock)",     Value: parseFloat(oBudget.PrCommitStockItem) || 0 },
                { Category: "PR Asset",              Value: parseFloat(oBudget.PrAsset) || 0 },
                { Category: "PR Commit (Non-Stock)", Value: parseFloat(oBudget.PrCommNonStockItem) || 0 },
                { Category: "PO (Non-Stock)",        Value: parseFloat(oBudget.TotalPONonStockItem) || 0 },
                { Category: "PO (Stock)",            Value: parseFloat(oBudget.TotalPoStockItem) || 0 },
                { Category: "PO Asset",              Value: parseFloat(oBudget.PoAsset) || 0 },
                { Category: "Actual Consumption",    Value: parseFloat(oBudget.ActualConsumption) || 0 },
                { Category: "IO Consumption",        Value: parseFloat(oBudget.IoConsump) || 0 },
                { Category: "Available Budget",      Value: parseFloat(oBudget.AvailableBuget) || 0 }
            ];

            this.getView().getModel("chartModel").setData({
                chartData: aChartData,
                hasData: true
            });
        }

    });
});