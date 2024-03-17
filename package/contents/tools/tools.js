/*
    SPDX-FileCopyrightText: 2024 Evgeny Kazantsev <exequtic@gmail.com>
    SPDX-License-Identifier: MIT
*/


function catchError(code, err) {
    if (err) {
        error = err.trim().substring(0, 100) + "..."
        setStatusBar(code)
        return true
    }
    return false
}


function runScript() {
    const script = `${cfg.script} copy`
    sh.exec(script, (cmd, stdout, stderr, exitCode) => {
        if (catchError(exitCode, stderr)) return
        checkDependencies()
    })
}


function runAction() {
    searchTimer.stop()
    error = null
    busy = true
}


function checkDependencies() {
    const populate = (data) => data.map(item => ({ "name": item.split("/").pop(), "value": item }))
    const checkPkg = (pkgs) => `for pgk in ${pkgs}; do command -v $pgk || echo; done`
    const pkgs = "pacman checkupdates flatpak paru trizen yay alacritty foot gnome-terminal konsole kitty lxterminal terminator tilix xterm yakuake"

    sh.exec(checkPkg(pkgs),(cmd, stdout, stderr, exitCode) => {
        if (catchError(exitCode, stderr)) return

        const out = stdout.split("\n")

        const [pacman, checkupdates, flatpak] = out.map(Boolean)
        cfg.packages = { pacman, checkupdates, flatpak }

        const wrappers = populate(out.slice(3, 6).filter(Boolean))
        cfg.wrappers = wrappers.length > 0 ? wrappers : null

        const terminals = populate(out.slice(6).filter(Boolean))
        cfg.terminals = terminals.length > 0 ? terminals : null

        !cfg.interval ? refreshListModel() : searchTimer.triggered()
    })
}


function defineCommands() {
    runAction()

    const trizen = cfg.wrapper.split("/").pop() === "trizen"
    const wrapperCmd = trizen ? `${cfg.wrapper} -Qu; ${cfg.wrapper} -Qu -a 2> >(grep ':: Unable' >&2)` : `${cfg.wrapper} -Qu`

    cmd.arch = pkg.checkupdates
        ? cfg.aur
            ? `bash -c "(checkupdates; ${wrapperCmd}) | sort -u -t' ' -k1,1"`
            : "checkupdates"
        : cfg.aur
            ? wrapperCmd
            : "ping -c 1 archlinux.org >/dev/null 2>&1 || { echo 'No internet' >&2; exit 1; }; pacman -Qu"     

    if (!pkg.pacman) delete cmd.arch

    const flatpak = cfg.flatpak ? "; flatpak update" : ""
    const flags = cfg.upgradeFlags ? ` ${cfg.upgradeFlagsText}` : " "
    const arch = cfg.wrapperUpgrade ? cfg.wrapper + " -Syu" + flags : "sudo pacman -Syu" + flags

    if (cfg.terminal.split("/").pop() === "yakuake") {
        const qdbus = "qdbus org.kde.yakuake /yakuake/sessions"
        cmd.upgrade = `${qdbus} addSession; ${qdbus} runCommandInTerminal $(${qdbus} org.kde.yakuake.activeSessionId) "${arch}${flatpak}"`
        return
    }

    const init = i18n("Full system upgrade")
    const done = i18n("Press Enter to close")
    const blue = "\x1B[1m\x1B[34m", bold = "\x1B[1m", reset = "\x1B[0m"
    const exec = blue + ":: " + reset + bold + i18n("Executed: ") + reset
    const executed = cfg.wrapperUpgrade && trizen ? "echo " : "echo; echo -e " + exec + arch + "; echo"

    const trap = "trap '' SIGINT"
    const terminalArg = { "gnome-terminal": " --", "terminator": " -x" }
    const terminalCmd = cfg.terminal + (terminalArg[cfg.terminal.split("/").pop()] || " -e")
    const mirrorlist = `sudo ${cfg.script} mirrorlist_generator ${cfg.mirrors} ${cfg.mirrorCount} '${cfg.dynamicUrl}'`
    cmd.upgrade = `${terminalCmd} sh -c "${trap}; ${print(init)}; ${executed}; ${mirrorlist}; ${arch}${flatpak}; ${print(done)}; read"`
}


function upgradeSystem() {
    defineCommands()

    statusIco = "accept_time_event"
    statusMsg = i18n("Full upgrade running...")
    upgrading = true

    sh.exec(cmd.upgrade, (cmd, stdout, stderr, exitCode) => {
        upgrading = false
        cfg.interval ? searchTimer.triggered() : refreshListModel()
    })
}


function checkUpdates() {
    defineCommands()

    let updArch
    let infArch
    let updFlpk
    let infFlpk

    cmd.arch ? archCheck() : cfg.flatpak ? flpkCheck() : merge()

    function archCheck() {
        statusIco = "package"
        statusMsg = cfg.aur ? i18n("Searching AUR for updates...")
                            : i18n("Searching arch repositories for updates...")
        sh.exec(cmd.arch, (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr)) return
            updArch = stdout ? stdout : null
            updArch ? archList() : cfg.flatpak ? flpkCheck() : merge()
    })}

    function archList() {
        sh.exec("pacman -Sl", (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr)) return
            infArch = stdout ? stdout : null
            cfg.flatpak ? flpkCheck() : merge()
    })}

    function flpkCheck() {
        statusIco = "flatpak-discover"
        statusMsg = i18n("Searching flathub for updates...")
        sh.exec("flatpak remote-ls --app --updates", (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr)) return
            updFlpk = stdout ? stdout : null
            updFlpk ? flpkList() : merge()
    })}

    function flpkList() {
        sh.exec("flatpak list --app", (cmd, stdout, stderr, exitCode) => {
            if (catchError(exitCode, stderr)) return
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
        out += `flatpak ${pkg.replace(name, vers)}\n`
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

        return cfg.sortByName ? nameA.localeCompare(nameB)
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
    const cache = cfg.cache.trim().split(",")
    const newList = list.filter(item => !cache.includes(item))
    const newCount = newList.length

    if (newCount > 0) {
        let lines = ""
        for (let i = 0; i < newCount; i++) {
            let col = newList[i].split(" ")
            lines += col[0] + "   → " + col[3] + "\n"
        }

        notifyTitle = i18np("+%1 new update", "+%1 new updates", newCount)
        notifyBody = lines
        notify.sendEvent()
    }
}


function refreshListModel(list) {
    list = list || (cfg.cache.length ? sortList(cfg.cache.trim().split(",")) : 0)
    count = list.length || 0
    setStatusBar()

    if (!count || !list) return

    listModel.clear()

    for (let i = 0; i < list.length; i++) {
        let item = list[i].split(" ")
        if (item[2] === item[3]) item[3] = "refresh"
        listModel.append({
            "name": item[0],
            "repo": item[1],
            "curr": item[2],
            "newv": item[3]
        })
    }
}


function finalize(list) {
    cfg.timestamp = new Date().getTime()

    if (!list) {
        listModel.clear()
        cfg.cache = ""
        count = 0
        setStatusBar()
        return
    }

    refreshListModel(list)

    cfg.notifications ? setNotify(list) : cfg.cache = ""

    count = list.length
    cfg.cache = list.join(",")
    setStatusBar()
}


function setStatusBar(code) {
    statusIco = error ? "error" : count > 0 ? "update-none" : ""
    statusMsg = error ? "Exit code: " + code : count > 0 ? i18np("%1 update is pending", "%1 updates total are pending", count) : ""
    busy = false
    !cfg.interval ? searchTimer.stop() : searchTimer.restart()
}


function getLastCheck() {
    if (!cfg.timestamp) return ""

    const diff = new Date().getTime() - cfg.timestamp
    const sec = Math.floor((diff % (1000 * 60)) / 1000)
    const min = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const hrs = Math.floor(diff / (1000 * 60 * 60))

    const lastcheck = i18n("Last check:")
    const second = i18np("%1 second", "%1 seconds", sec)
    const minute = i18np("%1 minute", "%1 minutes", min)
    const hour = i18np("%1 hour", "%1 hours", hrs)
    const ago = i18n("ago")

    if (hrs === 0 && min === 0) return `${lastcheck} ${second} ${ago}`
    if (hrs === 0) return `${lastcheck} ${minute} ${second} ${ago}`
    if (min === 0) return `${lastcheck} ${hour} ${ago}`
    return `${lastcheck} ${hour} ${minute} ${ago}`
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


function setFrameSize() {
    const multiplier = cfg.indicatorCounter && cfg.indicatorScale ? 1.1 :  
                       cfg.indicatorCounter && !cfg.indicatorScale ? 1 : 0.85

    return plasmoid.location === 5 || plasmoid.location === 6 ? icon.height * multiplier :     
           plasmoid.location === 3 || plasmoid.location === 4 ? icon.width * multiplier : 0
}


function setAnchor(pos, stop) {
    const anchors = {
        top: cfg.indicatorBottom && !cfg.indicatorTop,
        bottom: cfg.indicatorTop && !cfg.indicatorBottom,
        right: cfg.indicatorLeft && !cfg.indicatorRight,
        left: cfg.indicatorRight && !cfg.indicatorLeft
    }

    return (stop ? anchors[pos] : {
        top: anchors.bottom,
        bottom: anchors.top,
        right: anchors.left,
        left: anchors.right
    }[pos]) ? frame[pos] : undefined
}


function print(text) {
    let ooo = ":".repeat(48)
    let oo = ":".repeat(Math.ceil((ooo.length - text.length - 2) / 2))
    let o = text.length % 2 !== 0 ? oo.substring(1) : oo

    const green = "\x1B[1m\x1B[32m", bold = "\x1B[1m", reset = "\x1B[0m"
    text = bold + text + reset
    ooo = green + ooo + reset
    oo =  green + oo + reset
    o =  green + o + reset

    return `echo; echo -e ${ooo}
            echo -e ${oo} ${text} ${o}
            echo -e ${ooo}`
}


function switchInterval() {
    cfg.interval = !cfg.interval
}
