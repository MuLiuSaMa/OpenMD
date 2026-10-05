import { useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";

export default function LicensePage({ onAgreed }: { onAgreed: (v: boolean) => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    onAgreed(true);
  }, [onAgreed]);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      <h2 className="page-title">{t("license_title")}</h2>
      <p className="page-subtitle">{t("license_desc")}</p>

      <div className="license-scroll">
        <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{t("license_eula_title")}</p>
        <p style={{ color: "rgba(255, 255, 255, 0.5)", marginBottom: 6 }}>{t("license_eula_meta")}</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <p style={{ fontWeight: 600, marginTop: 10 }}>{t("license_important_head")}</p>
        <p>{t("license_important_text")}</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>{t("license_s1_title")}</h3>
        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s1_1_head")}</p>
        <p>
          <Trans i18nKey="license_s1_1_text" components={{ strong: <strong /> }} />
        </p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s1_2_head")}</p>
        <p>{t("license_s1_2_intro")}</p>
        <p><Trans i18nKey="license_s1_2_item1" components={{ strong: <strong /> }} /></p>
        <p><Trans i18nKey="license_s1_2_item2" components={{ strong: <strong /> }} /></p>
        <p><Trans i18nKey="license_s1_2_item3" components={{ strong: <strong /> }} /></p>
        <p><Trans i18nKey="license_s1_2_item4" components={{ strong: <strong /> }} /></p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s1_3_head")}</p>
        <p>{t("license_s1_3_intro")}</p>
        <p>
          {t("license_s1_3_github_prefix")}
          <a href="#" style={{ color: "#ffffff" }}>github.com/MuLiuSaMa/OpenMD</a>
        </p>
        <p>{t("license_s1_3_note")}</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>{t("license_s2_title")}</h3>
        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s2_1_head")}</p>
        <p>{t("license_s2_1_text")}</p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s2_2_head")}</p>
        <p>{t("license_s2_2_intro")}</p>
        <p>{t("license_s2_2_item1")}</p>
        <p>{t("license_s2_2_item2")}</p>
        <p>{t("license_s2_2_item3")}</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>{t("license_s3_title")}</h3>
        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s3_1_head")}</p>
        <p><Trans i18nKey="license_s3_1_intro" components={{ strong: <strong /> }} /></p>
        <p>{t("license_s3_1_item1")}</p>
        <p>{t("license_s3_1_item2")}</p>
        <p>{t("license_s3_1_item3")}</p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s3_2_head")}</p>
        <p>{t("license_s3_2_text")}</p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s3_3_head")}</p>
        <p>{t("license_s3_3_text")}</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>{t("license_s4_title")}</h3>
        <p>{t("license_s4_intro")}</p>
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "8px 0", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "rgba(255, 255, 255, 0.06)", borderBottom: "1px solid rgba(255, 255, 255, 0.15)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("license_table_component")}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("license_table_license")}</th>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600 }}>{t("license_table_desc")}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}><td style={{ padding: "5px 8px" }}>Tauri</td><td style={{ padding: "5px 8px" }}>MIT / Apache-2.0</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_tauri_desc")}</td></tr>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}><td style={{ padding: "5px 8px" }}>LibreHardwareMonitorLib</td><td style={{ padding: "5px 8px" }}>MPL-2.0</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_lhm_desc")}</td></tr>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}><td style={{ padding: "5px 8px" }}>WinDivert</td><td style={{ padding: "5px 8px" }}>LGPL-3.0</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_windivert_desc")}</td></tr>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}><td style={{ padding: "5px 8px" }}>Wintun</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_wintun_license")}</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_wintun_desc")}</td></tr>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}><td style={{ padding: "5px 8px" }}>NVIDIA NVAPI</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_nvapi_license")}</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_nvapi_desc")}</td></tr>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}><td style={{ padding: "5px 8px" }}>React</td><td style={{ padding: "5px 8px" }}>MIT</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_react_desc")}</td></tr>
            <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}><td style={{ padding: "5px 8px" }}>{t("license_tbl_rust_name")}</td><td style={{ padding: "5px 8px" }}>MIT / Apache-2.0</td><td style={{ padding: "5px 8px" }}>{t("license_tbl_rust_desc")}</td></tr>
          </tbody>
        </table>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>{t("license_s5_title")}</h3>
        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s5_1_head")}</p>
        <p><Trans i18nKey="license_s5_1_intro" components={{ strong: <strong /> }} /></p>
        <p><Trans i18nKey="license_s5_1_item1" components={{ strong: <strong /> }} /></p>
        <p><Trans i18nKey="license_s5_1_item2" components={{ strong: <strong /> }} /></p>
        <p><Trans i18nKey="license_s5_1_item3" components={{ strong: <strong /> }} /></p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s5_2_head")}</p>
        <p>{t("license_s5_2_text")}</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>{t("license_s6_title")}</h3>
        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s6_1_head")}</p>
        <p>{t("license_s6_1_text")}</p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s6_2_head")}</p>
        <p>{t("license_s6_2_text")}</p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 8px" }}>{t("license_s7_title")}</h3>
        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s7_1_head")}</p>
        <p>{t("license_s7_1_text")}</p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s7_2_head")}</p>
        <p>{t("license_s7_2_text")}</p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s7_3_head")}</p>
        <p>{t("license_s7_3_text")}</p>

        <p style={{ fontWeight: 600, marginTop: 8 }}>{t("license_s7_4_head")}</p>
        <p>{t("license_s7_4_intro")}</p>
        <p>
          {t("license_s7_4_github_prefix")}
          <a href="#" style={{ color: "#ffffff" }}>github.com/MuLiuSaMa/OpenMD</a>
        </p>
        <p>
          {t("license_s7_4_site_prefix")}
          <a href="#" style={{ color: "#ffffff" }}>www.OpenMD.top</a>
        </p>
        <hr style={{ border: "none", borderTop: "1px solid rgba(255, 255, 255, 0.15)", margin: "12px 0" }} />

        <p style={{ fontWeight: 600 }}>{t("license_footer")}</p>
      </div>
    </div>
  );
}
