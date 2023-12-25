
function catchError(code, err, out) {
    if (code) {
        if (err) error = err.trim().split("\n")[0]
        if (!err && out) error = out.trim().split("\n")[0]
        if (!err && !out) return false

        setStatusBar(code)
        return true
    }
    return false
}


function waitConnection(func) {
    if (!connectionStatus()) {
        statusIco = "network-connect"
        statusMsg = i18n("Waiting for internet connection...")

        if (!connectionTimer.running) {
            action = func ? func : false
            connectionTimer.start()
        }
        return
    }

    connectionTimer.stop()

    if (action) return action()

    setStatusBar()
}


function connectionStatus() {
    searchTimer.stop()
    error = null
    busy = true

    const status = connection.connectionIcon
    return connection.connecting === true
            || status.includes("limited")
            || status.includes("unavailable")
            || status.includes("disconected")
            || status.includes("available")
                ? false
                : true
}


function runScript() {
    let homeDir = StandardPaths.writableLocation(StandardPaths.HomeLocation).toString().substring(7)
    let script = homeDir + "/.local/share/plasma/plasmoids/" + applet + "/contents/tools/tools.sh"
    let command = `${script} copy`

    sh.exec(command, (cmd, stdout, stderr, exitCode) => {
        if (catchError(exitCode, stderr, stdout)) return
        checkDependencies()
    })
}


function checkDependencies() {
    function check(packs) {
        return `for pgk in ${packs}; do command -v $pgk || echo; done`
    }

    function populate(data) {
        let arr = []
        for (let i = 0; i < data.length; i++) {
            arr.push({"name": data[i].split("/").pop(), "value": data[i]})
        }
        return arr
    }

    sh.exec(check(plasmoid.configuration.dependencies), (cmd, stdout, stderr, exitCode) => {
        if (catchError(exitCode, stderr, stdout)) return

        let out = stdout.split("\n")
        let packs = out.slice(0, 4)
        let wrappers = populate(out.slice(4, 12).filter(Boolean))
        let terminals = populate(out.slice(12).filter(Boolean))

        plasmoid.configuration.packages = packs
        plasmoid.configuration.wrappers = wrappers.length > 0 ? wrappers : null
        plasmoid.configuration.terminals = terminals.length > 0 ? terminals : null

        searchTimer.triggered()
    })
}


function defineCommands() {
    let exec = i18n("Executed: ")
    let init = i18n("Full system upgrade")
    let done = i18n("Press Enter to close")

    shell[0] = packages[0] + " -c"
    shell[1] = packages[1] && searchMode[0] ? packages[1] + " -Qu" :
               searchMode[1] ? packages[2] :
               searchMode[2] ? plasmoid.configuration.selectedWrapper + " -Qu"
               : null
    shell[2] = packages[1] + " -Sl"
    shell[3] = packages[3] + " remote-ls --app --updates"
    shell[4] = packages[3] + " list --app"
    shell[5] = searchMode[0] || searchMode[1] ? packages[1] + " -Sy" : shell[1].replace("Qu", "Sy")
    shell[6] = plasmoid.configuration.selectedTerminal
    shell[7] = defineTermArg(shell[6])
    shell[8] = plasmoid.configuration.wrapperUpgrade ? plasmoid.configuration.selectedWrapper + " -Syu" : "sudo " + packages[1] + " -Syu"
    shell[8] = !packages[1] ? "echo" : plasmoid.configuration.upgradeFlags ? shell[8] + " " + plasmoid.configuration.upgradeFlagsText : shell[8]
    shell[9] = searchMode[3] ? packages[3] + " update" : "echo "
    shell[10] = "trap '' SIGINT"
    shell[11] = packages[1] ? "echo " + exec + shell[8] + "; echo" : "echo " + exec + shell[9] + "; echo"

    function defineTermArg(term) {
        switch (term.split("/").pop()) {
            case "gnome-terminal": return "--"
            case "terminator": return "-x"
            case "yakuake": return false
            default: return "-e"
        }
    }

    if (shell[7]) {
        shell[12] = `${shell[6]} ${shell[7]} ${shell[0]} "${shell[10]}; ${print(init)}; ${shell[11]}; ${shell[8]}; ${shell[9]}; ${print(done)}; read"`
    } else {
        let QDBUS = "qdbus org.kde.yakuake /yakuake/sessions"
        shell[12] = `${QDBUS} addSession; ${QDBUS} runCommandInTerminal $(${QDBUS} org.kde.yakuake.activeSessionId) "${shell[8]}; ${shell[9]}"`
    }
}


function upgradeSystem() {
    if (!connectionStatus()) return waitConnection()

    statusIco = "accept_time_event"
    statusMsg = i18n("Full upgrade running...")
    upgrading = true

    defineCommands() 

    sh.exec(shell[12], (cmd, stdout, stderr, exitCode) => {
        upgrading = false

        if (catchError(exitCode, stderr, stdout)) return

        searchTimer.triggered()
    })
}


function downloadDatabase() {
    if (!connectionStatus()) return waitConnection()

    statusIco = "download"
    statusMsg = i18n("Download fresh package databases...")
    downloading = true

    sh.exec("pkexec " + shell[5], (cmd, stdout, stderr, exitCode) => {
        downloading = false

        if (exitCode == 127) {
            setStatusBar()
            return
        }

        if (catchError(exitCode, stderr, stdout)) return

        searchTimer.triggered()
    })
}


function checkUpdates() {
    if (!connectionStatus()) return waitConnection(checkUpdates)

    defineCommands()

    let updArch
    let infArch
    let updFlpk
    let infFlpk

    shell[1] ? archCheck() : searchMode[3] ? flpkCheck() : merge()

    function archCheck() {
        statusIco = "package"
        statusMsg = searchMode[2] ? i18n("Searching AUR for updates...")
                                  : i18n("Searching arch repositories for updates...")

        sh.exec(shell[1], (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr, stdout)) return
            updArch = stdout ? stdout : null
            updArch ? archList() : searchMode[3] ? flpkCheck() : merge()
    })}

    function archList() {
        sh.exec(shell[2], (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr, stdout)) return
            infArch = stdout ? stdout : null
            searchMode[3] ? flpkCheck() : merge()
    })}

    function flpkCheck() {
        statusIco = "flatpak-discover"
        statusMsg = i18n("Searching flathub for updates...")

        sh.exec(shell[3], (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr, stdout)) return
            updFlpk = stdout ? stdout : null
            updFlpk ? flpkList() : merge()
    })}

    function flpkList() {
        sh.exec(shell[4], (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr, stdout)) return
            infFlpk = stdout ? stdout : null
            merge()
    })}

    function merge() {
        updArch = updArch ? makeArchList(updArch, infArch) : null
        updFlpk = updFlpk ? makeFlpkList(updFlpk, infFlpk) : null
    
        updArch && !updFlpk ? finalize(sortList(formatList(updArch))) :
        !updArch && updFlpk ? finalize(sortList(formatList(updFlpk))) :
        !updArch && !updFlpk ? finalize() :
        finalize(sortList(formatList(updArch.concat(updFlpk))))
    }
}


function makeArchList(upd, inf) {
    upd = upd.trim().split("\n")
    inf = inf.trim().split("\n")
    let out = ""

    for (let i = 0; i < upd.length; i++) {
        let pkg = upd[i]
        let name = pkg.split(" ")[0]
        let aur = true

        for (let j = 0; j < inf.length; j++)
            if (inf[j].includes(" " + name + " ")) {
                let repo = inf[j].split(" ")[0]
                out += repo + " " + pkg + "\n"
                aur = false
                break
            }

        if (aur)
            pkg.split(" ").pop() === "latest-commit" ?
                out += "devel " + pkg + "\n" :
                out += "aur " + pkg + "\n"
    }

    return out
}


function makeFlpkList(upd, inf) {
    upd = upd.trim().replace(/ /g, "-").replace(/\t/g, " ").split("\n")
    inf = inf.trim().replace(/ /g, "-").replace(/\t/g, " ").split("\n")
    let out = ""

    upd.forEach(pkg => {
        let name = pkg.split(" ")[1]
        let vers = inf.find(line => line.includes(name)).split(" ")[2]
        out += `flathub ${pkg.replace(name, vers)}\n`
    })

    return out
}


function formatList(list) {
    return list
        .replace(/ ->/g, "")
        .trim()
        .toLowerCase()
        .split("\n")
        .map(str => {
            const col = str.split(" ");
            [col[0], col[1]] = [col[1], col[0]]
            return col.join(" ")
        })
}


function sortList(list) {
    return list.sort((a, b) => {
        const [nameA, repoA] = a.split(" ")
        const [nameB, repoB] = b.split(" ")

        return plasmoid.configuration.sortByName ? nameA.localeCompare(nameB)
                : ((repoA.includes("aur") || repoA.includes("devel"))
                    &&
                  !(repoB.includes("aur") || repoB.includes("devel")))
                    ? -1
                : (!(repoA.includes("aur") || repoA.includes("devel"))
                    &&
                  (repoB.includes("aur") || repoB.includes("devel")))
                    ? 1
                : repoA.localeCompare(repoB) || nameA.localeCompare(nameB)
    })
}


function setNotify(list) {
    let prev = count
    let curr = list.length

    if (prev !== undefined && prev < curr) {
        let newList = list.filter(item => !updList.includes(item))
        let newCount = newList.length

        let lines = ""
        for (let i = 0; i < newCount; i++) {
            let col = newList[i].split(" ")
            lines += col[0] + "  -> " + col[3] + "\n"
        }

        notifyTitle = i18np("+%1 new update", "+%1 new updates", newCount)
        notifyBody = lines
        notify.sendEvent()
    }

    if (prev === undefined && curr > 0 && plasmoid.configuration.notifyStartup) {
        notifyTitle = i18np("Update available", "Updates available", curr)
        notifyBody = i18np("One update is pending", "%1 updates total are pending", curr)
        notify.sendEvent()
    }
}


function refreshListModel(list) {
    if (!list) {
        if (updList.length == 0) return
        list = sortList(updList)
    }

    listModel.clear()

    for (let i = 0; i < list.length; i++) {
        let item = list[i].split(" ")
        listModel.append({
            "name": item[0],
            "repo": item[1],
            "curr": item[2],
            "newv": item[3]
        })
    }
}


function finalize(list) {
    lastCheck = new Date().toLocaleTimeString().slice(0, -7)

    if (!list) {
        listModel.clear()
        updList = [""]
        count = 0
        setStatusBar()
        return
    }

    refreshListModel(list)

    if (plasmoid.configuration.notifications) setNotify(list)

    count = list.length
    updList = list
    setStatusBar()
}


function setStatusBar(code) {
    statusIco = error ? "error" : count > 0 ? "update-none" : ""
    statusMsg = error ? "Exit code: " + code : count > 0 ? i18np("%1 update is pending", "%1 updates total are pending", count) : ""
    busy = false
    searchTimer.restart()
}


function setIndex(value, arr) {
    let index = 0
    for (let i = 0; i < arr.length; i++) {
        if (arr[i]["value"] == value) {
            index = i
            break
        }
    }
    return index
}


const defaultIcon = "apdatifier-plasmoid"
function setIcon(icon) {
    return icon === "" ? defaultIcon : icon
}


function indicatorFrameSize() {
    const multiplier = plasmoid.configuration.indicatorCounter ? 1 : plasmoid.configuration.indicatorCircle ? 0.85 : 0

    return plasmoid.location === 5 || plasmoid.location === 6 ? icon.height * multiplier :     
           plasmoid.location === 3 || plasmoid.location === 4 ? icon.width * multiplier : 0
}


function indicatorAnchors(pos) {
    switch (pos) {
        case "top": return plasmoid.configuration.indicatorTop && !plasmoid.configuration.indicatorBottom ? frame.top : undefined
        case "bottom": return plasmoid.configuration.indicatorBottom && !plasmoid.configuration.indicatorTop ? frame.bottom : undefined
        case "right": return plasmoid.configuration.indicatorRight && !plasmoid.configuration.indicatorLeft ? frame.right : undefined
        case "left": return plasmoid.configuration.indicatorLeft && !plasmoid.configuration.indicatorRight ? frame.left : undefined
        default: return undefined
    }
}


function getFonts(defaultFont, fonts) {
    let arr = []
    arr.push({"name": i18n("Default system font"), "value": defaultFont})
    for (let i = 0; i < fonts.length; i++) {
        arr.push({"name": fonts[i], "value": fonts[i]})
    }
    return arr
}


function print(text) {
    let ooo = ":".repeat(48)
    let oo = ":".repeat(Math.ceil((ooo.length - text.length - 2)/2))
    let o = text.length % 2 !== 0 ? oo.substring(1) : oo

    return `echo; echo ${ooo}
            echo ${oo} ${text} ${o}
            echo ${ooo}; echo`
}
