// ClipBoardLine share window: qml6 share.qml -- <file>
// KDE Purpose lists the system's export targets (KDE Connect, e-mail, Imgur, …) for one PNG.
import QtQuick
import QtQuick.Controls
import org.kde.purpose as Purpose

ApplicationWindow {
    id: root
    width: 420
    height: 520
    visible: true
    title: String(Qt.uiLanguage || Qt.locale().name).startsWith("tr") ? "Paylaş" : "Share"

    // The image path is the last command-line argument (after "--").
    readonly property string file: Qt.application.arguments[Qt.application.arguments.length - 1]

    onClosing: Qt.quit()

    Purpose.AlternativesView {
        anchors.fill: parent
        pluginType: "Export"
        // Each path segment is percent-encoded so names with '#', '%' or spaces stay one file URL.
        inputData: ({
            urls: [Qt.resolvedUrl("file://" + root.file.split("/").map(encodeURIComponent).join("/"))],
            mimeType: "image/png"
        })
        onFinished: Qt.quit()
    }
}
