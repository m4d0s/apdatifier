function checkUpdates() {
    console.log(`\n\n     (${new Date().toLocaleTimeString().slice(0, -4)}) ----- Start checkUpdates() -----`)
    timer.restart()
    updatesListModel.clear()
    checkStatus = true
    errorStd = null
    updatesCount = null
    
    let helper = "$(command -v yay || command -v paru || command -v picaur || command -v pacman)"
    let search = '$(command -v checkupdates) || $(command -v pacman) -Qu'

    if (wrapper) {
        search = helper + ' -Qu'
    }

    let checkUpdatesCmd = `\
        upd=$(${search})
        if [ ! -z "$upd" ]; then
            all=$(${helper} -Sl)
            while IFS= read -r pkg; do
                name=$(echo "$pkg" | awk '{print $1}')
                repo=$(echo "$all" | grep " $name " | awk '{print $1}')
                pkgs+="$repo $pkg\n"
            done <<< "$upd"
            echo -en "$pkgs"
        fi`

    if (flatpak) {
        let checkFlatpakCmd = `\
            upd=$(flatpak remote-ls --columns=name,application,version --app --updates | \
            sed 's/ /-/g' | sed 's/\t/ /g')
            if [ ! -z "$upd" ]; then
                while IFS= read -r app; do
                    name=$(echo "$app" | awk '{print $2}')
                    vers=$(flatpak info "$name" | grep "Version:" | awk '{print $2}')
                    apps+="flathub $(echo "$app" | sed "s/$name/$vers/")"$'\n'
                done <<< "$upd"
                echo -en "$apps"
            fi`

        checkUpdatesCmd = `${checkUpdatesCmd} && ${checkFlatpakCmd}`
    }
    
    sh.exec('sleep 1 && cat /home/exequtic/file.txt')
}



function makeList() {
    if (errorStd || !updatesListOut) {
        errorStd = errorStd.split("\n")
        checkStatus = false
        return
    }

    updatesListObj = updatesListOut
        .replace(/ ->/g, "")
            .trim()
                .split("\n")
                    .map(str => {
                        const col = str.split(' ');
                        [col[0], col[1]] = [col[1], col[0]]
                        return col.join(' ')
                    })

    updatesListObj.sort((a, b) => {
        const [nameA, repoA] = a.split(' ');
        const [nameB, repoB] = b.split(' ');
        return sortMode === 0 ?
            nameA.localeCompare(nameB) :
            repoA.localeCompare(repoB) || nameA.localeCompare(nameB)
    })

    updatesCount = updatesListObj.length

    updatesListModel.clear()

    for (var i = 0; i < updatesCount; i++) {
        let item = updatesListObj[i].toLowerCase()
        updatesListModel.append({"text": item})
    }

    checkStatus = false
}

function colWidth(col, w) {
    switch (col) {
        case 0: return w * [0.40, 0.40, 0.65, 1.00, 0.80, 0.50][colMode]
        case 1: return w * [0.10, 0.00, 0.00, 0.00, 0.20, 0.15][colMode]
        case 2: return w * [0.25, 0.30, 0.00, 0.00, 0.00, 0.00][colMode]
        case 3: return w * [0.25, 0.30, 0.35, 0.00, 0.00, 0.35][colMode]
    }
}