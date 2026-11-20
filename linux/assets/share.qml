// ClipBoardLine share window: qml6 share.qml -- <mime> <file>
// KDE Purpose lists the system's export targets (KDE Connect, e-mail, Imgur, …) for one image.
import QtQuick
import QtQuick.Controls
import org.kde.purpose as Purpose

ApplicationWindow {
    id: root
    width: 420
    height: 520
    visible: true
    title: String(Qt.uiLanguage || Qt.locale().name).startsWith("tr") ? "Paylaş" : "Share"

    // The arguments after "--" are the image's MIME type and its path (the last argument).
    readonly property var args: Qt.application.arguments
    readonly property string file: args[args.length - 1]
    readonly property string mime: args.length >= 2 && /^image\/[a-z0-9.+-]+$/.test(args[args.length - 2]) ? args[args.length - 2] : "image/png"

    onClosing: Qt.quit()

    Purpose.AlternativesView {
        anchors.fill: parent
        pluginType: "Export"
        // Each path segment is percent-encoded so names with '#', '%' or spaces stay one file URL.
        inputData: ({
            urls: [Qt.resolvedUrl("file://" + root.file.split("/").map(encodeURIComponent).join("/"))],
            mimeType: root.mime
        })
        onFinished: Qt.quit()
    }
}
