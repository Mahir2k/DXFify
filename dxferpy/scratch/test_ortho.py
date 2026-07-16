dom_dirs = [2.0]
peak = 91.0

def check(peak):
    diff = abs(peak - dom_dirs[0]) % 180
    diff_to_ortho = abs(diff - 90)
    if diff_to_ortho < 5.0:
        return (dom_dirs[0] + 90) % 180
    return peak

print(f"Peak 91 -> {check(91)}")
print(f"Peak 95 -> {check(95)}")
print(f"Peak 88 -> {check(88)}")
print(f"Peak 45 -> {check(45)}")
