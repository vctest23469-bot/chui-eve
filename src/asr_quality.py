import re

def repetitive(text):
    # Only reject sustained identical phrases, not ordinary repeated words.
    units=re.findall(r'[a-z0-9]+|[\u4e00-\u9fff]',text.lower())
    for width in range(1,13):
        for start in range(max(0,len(units)-width*8+1)):
            phrase=units[start:start+width]
            count=1
            while units[start+count*width:start+(count+1)*width]==phrase:
                count+=1
            if count>=8 and count*width>=24 and count*width>=len(units)*0.6:
                return True
    return False
