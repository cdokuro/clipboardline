#include <X11/Xlib.h>
#include <stdio.h>

int main(void) {
    Display *d = XOpenDisplay(NULL);
    if (!d) return 1;
    Window root = DefaultRootWindow(d), r_ret, c_ret;
    int rx, ry, wx, wy;
    unsigned int mask;
    if (XQueryPointer(d, root, &r_ret, &c_ret, &rx, &ry, &wx, &wy, &mask)) {
        printf("%d %d\n", rx, ry);
        XCloseDisplay(d);
        return 0;
    }
    XCloseDisplay(d);
    return 1;
}
